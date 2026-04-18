import type { DeleteAllSpamResponse, IOutgoingMessage, Label, ParsedMessage, Sender } from '../../types';
import { sanitizeTipTapHtml } from '../sanitize-tip-tap-html';
import type { IGetThreadResponse, MailManager, ParsedDraft } from './types';
import { decryptCredential } from '../credential-crypto';
import { createMimeMessage } from 'mimetext';
import { simpleParser } from 'mailparser';
import { ImapFlow } from 'imapflow';
import { env } from '../../env';
import nodemailer from 'nodemailer';
import type { CreateDraftData } from '../schemas';

type MailboxName = 'INBOX' | 'Sent' | 'Drafts' | 'Trash' | 'Junk' | 'Archive';

const FOLDER_TO_MAILBOX: Record<string, MailboxName> = {
  inbox: 'INBOX',
  sent: 'Sent',
  draft: 'Drafts',
  bin: 'Trash',
  spam: 'Junk',
  archive: 'Archive',
};

const KNOWN_MAILBOXES: MailboxName[] = ['INBOX', 'Sent', 'Drafts', 'Trash', 'Junk', 'Archive'];

export class ImapMailManager implements MailManager {
  constructor(public config: { auth: { userId: string; accessToken: string; refreshToken: string; email: string } }) {}

  private async getPassword() {
    const password = this.config.auth.refreshToken || this.config.auth.accessToken;
    if (!password) throw new Error('Missing IMAP/SMTP password in connection credentials');
    return await decryptCredential(password);
  }

  private async createImapClient() {
    if (!env.IMAP_HOST || !env.IMAP_PORT) throw new Error('IMAP server is not configured');
    const password = await this.getPassword();
    return new ImapFlow({
      host: env.IMAP_HOST,
      port: Number(env.IMAP_PORT),
      secure: env.IMAP_SECURE === 'true',
      auth: {
        user: this.config.auth.email,
        pass: password,
      },
    });
  }

  private async createSmtpTransporter() {
    if (!env.SMTP_HOST || !env.SMTP_PORT) throw new Error('SMTP server is not configured');
    const password = await this.getPassword();
    return nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: Number(env.SMTP_PORT),
      secure: env.SMTP_SECURE === 'true',
      auth: {
        user: this.config.auth.email,
        pass: password,
      },
    });
  }

  private async withImap<T>(runner: (client: ImapFlow) => Promise<T>) {
    const client = await this.createImapClient();
    await client.connect();
    try {
      return await runner(client);
    } finally {
      await client.logout().catch(() => undefined);
    }
  }

  private getMailbox(folder: string) {
    return FOLDER_TO_MAILBOX[folder] ?? 'INBOX';
  }

  private sourceToString(source: unknown) {
    if (typeof source === 'string') return source;
    if (source instanceof Uint8Array) return Buffer.from(source).toString('utf8');
    if (source instanceof ArrayBuffer) return Buffer.from(source).toString('utf8');
    return '';
  }

  private toSenderList(input: { value?: { address?: string; name?: string }[] } | undefined): Sender[] {
    if (!input?.value?.length) return [];
    return input.value
      .map((v) => ({ email: v.address || '', name: v.name || undefined }))
      .filter((v) => !!v.email);
  }

  private async fetchByUidAcrossMailboxes(client: ImapFlow, uid: number) {
    for (const mailbox of KNOWN_MAILBOXES) {
      try {
        await client.mailboxOpen(mailbox);
        const msg = await client.fetchOne(
          uid,
          {
            uid: true,
            source: true,
            envelope: true,
            flags: true,
            internalDate: true,
          },
          { uid: true },
        );
        if (msg) return { mailbox, msg };
      } catch {
        continue;
      }
    }
    return null;
  }

  private toParsedMessage(rawUid: number, source: string, raw: { flags?: Set<string>; internalDate?: Date }) {
    return simpleParser(source).then((parsed): ParsedMessage => {
      const to = this.toSenderList(parsed.to);
      const cc = this.toSenderList(parsed.cc);
      const bcc = this.toSenderList(parsed.bcc);
      const from = this.toSenderList(parsed.from)[0] || {
        email: this.config.auth.email,
        name: undefined,
      };
      const received = raw.internalDate?.toISOString() ?? parsed.date?.toISOString() ?? new Date().toISOString();
      const htmlBody =
        typeof parsed.html === 'string' ? parsed.html : parsed.textAsHtml || `<p>${parsed.text || ''}</p>`;
      const attachments = (parsed.attachments || []).map((a) => ({
        attachmentId: `${rawUid}:${a.filename || a.contentType || 'attachment'}`,
        filename: a.filename || 'attachment',
        mimeType: a.contentType || 'application/octet-stream',
        size: a.size || a.content?.length || 0,
        body: Buffer.from(a.content).toString('base64'),
        headers: [],
      }));
      const tags = Array.from(raw.flags || []).map((flag) => ({
        id: flag,
        name: flag,
        type: 'system',
      }));

      return {
        id: String(rawUid),
        title: parsed.subject || '(no subject)',
        subject: parsed.subject || '',
        tags,
        sender: from,
        to,
        cc: cc.length ? cc : null,
        bcc: bcc.length ? bcc : null,
        tls: true,
        receivedOn: received,
        unread: !(raw.flags?.has('\\Seen') ?? false),
        body: parsed.text || '',
        processedHtml: htmlBody,
        blobUrl: '',
        references: parsed.references?.join(' ') || undefined,
        inReplyTo: parsed.inReplyTo || undefined,
        replyTo: this.toSenderList(parsed.replyTo)[0]?.email,
        messageId: parsed.messageId || undefined,
        threadId: String(rawUid),
        attachments,
      };
    });
  }

  public getScope(): string {
    return 'imap smtp';
  }

  public async getMessageAttachments(id: string) {
    const parsed = await this.get(id);
    return parsed.messages.flatMap((m) =>
      (m.attachments || []).map((a) => ({
        filename: a.filename,
        mimeType: a.mimeType,
        size: a.size,
        attachmentId: a.attachmentId,
        headers: a.headers.map((h) => ({ name: h.name || '', value: h.value || '' })),
        body: a.body,
      })),
    );
  }

  public async get(id: string): Promise<IGetThreadResponse> {
    const uid = Number(id);
    if (!Number.isFinite(uid)) throw new Error('Invalid IMAP message id');

    return this.withImap(async (client) => {
      const found = await this.fetchByUidAcrossMailboxes(client, uid);
      if (!found?.msg?.source) {
        return { messages: [], hasUnread: false, totalReplies: 0, labels: [] };
      }
      const source = this.sourceToString(found.msg.source);
      const parsed = await this.toParsedMessage(uid, source, {
        flags: found.msg.flags as Set<string> | undefined,
        internalDate: found.msg.internalDate as Date | undefined,
      });

      return {
        messages: [parsed],
        latest: parsed,
        hasUnread: parsed.unread,
        totalReplies: 0,
        labels: [{ id: found.mailbox, name: found.mailbox }],
      };
    });
  }

  public async create(data: IOutgoingMessage): Promise<{ id?: string | null }> {
    const transporter = await this.createSmtpTransporter();
    const info = await transporter.sendMail({
      from: data.fromEmail || this.config.auth.email,
      to: data.to.map((r) => r.email).join(', '),
      cc: data.cc?.map((r) => r.email).join(', '),
      bcc: data.bcc?.map((r) => r.email).join(', '),
      subject: data.subject,
      html: sanitizeTipTapHtml(data.message),
      text: data.message.replace(/<[^>]+>/g, ' '),
      attachments: (data.attachments || []).map((a) => ({
        filename: a.name,
        contentType: a.type,
        content: Buffer.from(a.base64, 'base64'),
      })),
      headers: data.headers,
    });

    return { id: info.messageId || null };
  }

  public async sendDraft(_id: string, data: IOutgoingMessage): Promise<void> {
    await this.create(data);
  }

  public async createDraft(
    data: CreateDraftData,
  ): Promise<{ id?: string | null; success?: boolean; error?: string }> {
    return this.withImap(async (client) => {
      await client.mailboxOpen('Drafts');
      const message = createMimeMessage();
      message.setSender({ addr: data.from?.email || this.config.auth.email, name: data.from?.name });
      message.setTo((data.to || []).map((r) => ({ addr: r.email, name: r.name })));
      if (data.cc?.length) message.setCc(data.cc.map((r) => ({ addr: r.email, name: r.name })));
      if (data.bcc?.length) message.setBcc(data.bcc.map((r) => ({ addr: r.email, name: r.name })));
      message.setSubject(data.subject || '');
      message.addMessage({
        contentType: 'text/html',
        data: sanitizeTipTapHtml(data.message || ''),
      });

      const raw = message.asRaw();
      const appendResult = await client.append('Drafts', raw, ['\\Draft']);
      return {
        id: appendResult?.uid ? String(appendResult.uid) : null,
        success: true,
      };
    });
  }

  public async getDraft(id: string): Promise<ParsedDraft> {
    const thread = await this.get(id);
    const message = thread.messages[0];
    if (!message) return { id };
    return {
      id,
      to: message.to.map((t) => t.email),
      cc: message.cc?.map((t) => t.email) || [],
      bcc: message.bcc?.map((t) => t.email) || [],
      subject: message.subject,
      content: message.processedHtml,
      rawMessage: {
        internalDate: message.receivedOn,
      },
    };
  }

  public async listDrafts(params: { q?: string; maxResults?: number; pageToken?: string }) {
    return this.list({
      folder: 'draft',
      query: params.q,
      maxResults: params.maxResults,
      pageToken: params.pageToken,
    });
  }

  public async delete(id: string): Promise<void> {
    const uid = Number(id);
    if (!Number.isFinite(uid)) return;
    await this.withImap(async (client) => {
      const found = await this.fetchByUidAcrossMailboxes(client, uid);
      if (!found) return;
      await client.messageDelete(uid, { uid: true });
      if (found.mailbox !== 'Trash') {
        await client.messageMove(uid, 'Trash', { uid: true }).catch(() => undefined);
      }
    });
  }

  public async deleteDraft(id: string): Promise<void> {
    await this.delete(id);
  }

  public async list(params: {
    folder: string;
    query?: string;
    maxResults?: number;
    labelIds?: string[];
    pageToken?: string | number;
  }) {
    return this.withImap(async (client) => {
      const mailbox = this.getMailbox(params.folder);
      await client.mailboxOpen(mailbox);
      const allUids = await client.search({});
      const sorted = [...allUids].sort((a, b) => b - a);
      const offset = Number(params.pageToken || 0);
      const max = params.maxResults || 100;
      const selected = sorted.slice(offset, offset + max);

      return {
        threads: selected.map((uid) => ({
          id: String(uid),
          historyId: null,
          $raw: { uid, mailbox },
        })),
        nextPageToken: offset + max < sorted.length ? String(offset + max) : null,
      };
    });
  }

  public async count(): Promise<{ count?: number; label?: string }[]> {
    return this.withImap(async (client) => {
      const results: { count?: number; label?: string }[] = [];
      for (const mailbox of KNOWN_MAILBOXES) {
        try {
          const status = await client.status(mailbox, { messages: true, unseen: true });
          results.push({
            label: mailbox,
            count: mailbox === 'INBOX' ? status.unseen || 0 : status.messages || 0,
          });
        } catch {
          continue;
        }
      }
      return results;
    });
  }

  public async getTokens(): Promise<{
    tokens: { access_token?: string; refresh_token?: string; expiry_date?: number };
  }> {
    return {
      tokens: {
        access_token: this.config.auth.accessToken,
        refresh_token: this.config.auth.refreshToken,
      },
    };
  }

  public async getUserInfo(): Promise<{ address: string; name: string; photo: string }> {
    return {
      address: this.config.auth.email,
      name: this.config.auth.email,
      photo: '',
    };
  }

  public async listHistory<T>(_historyId: string): Promise<{ history: T[]; historyId: string }> {
    return { history: [], historyId: '' };
  }

  public async markAsRead(threadIds: string[]): Promise<void> {
    await this.withImap(async (client) => {
      for (const id of threadIds) {
        const uid = Number(id);
        if (!Number.isFinite(uid)) continue;
        await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true }).catch(() => undefined);
      }
    });
  }

  public async markAsUnread(threadIds: string[]): Promise<void> {
    await this.withImap(async (client) => {
      for (const id of threadIds) {
        const uid = Number(id);
        if (!Number.isFinite(uid)) continue;
        await client.messageFlagsRemove(uid, ['\\Seen'], { uid: true }).catch(() => undefined);
      }
    });
  }

  public normalizeIds(id: string[]): { threadIds: string[] } {
    return { threadIds: id };
  }

  public async modifyLabels(
    id: string[],
    options: { addLabels: string[]; removeLabels: string[] },
  ): Promise<void> {
    await this.withImap(async (client) => {
      const add = options.addLabels.filter(Boolean);
      const remove = options.removeLabels.filter(Boolean);
      for (const raw of id) {
        const uid = Number(raw);
        if (!Number.isFinite(uid)) continue;
        if (add.length) await client.messageFlagsAdd(uid, add, { uid: true }).catch(() => undefined);
        if (remove.length)
          await client.messageFlagsRemove(uid, remove, { uid: true }).catch(() => undefined);
      }
    });
  }

  public async getAttachment(messageId: string, attachmentId: string): Promise<string | undefined> {
    const attachments = await this.getMessageAttachments(messageId);
    return attachments.find((a) => a.attachmentId === attachmentId)?.body;
  }

  public async getUserLabels(): Promise<Label[]> {
    return this.withImap(async (client) => {
      const mailboxes = await client.list();
      return mailboxes.map((mailbox) => ({
        id: mailbox.path,
        name: mailbox.name,
        type: mailbox.specialUse || 'user',
      }));
    });
  }

  public async getLabel(id: string): Promise<Label> {
    const labels = await this.getUserLabels();
    return labels.find((label) => label.id === id) || { id, name: id, type: 'user' };
  }

  public async createLabel(label: {
    name: string;
    color?: { backgroundColor: string; textColor: string };
  }): Promise<void> {
    await this.withImap(async (client) => {
      await client.mailboxCreate(label.name);
    });
  }

  public async updateLabel(
    id: string,
    label: { name: string; color?: { backgroundColor: string; textColor: string } },
  ): Promise<void> {
    await this.withImap(async (client) => {
      if (id !== label.name) await client.mailboxRename(id, label.name);
    });
  }

  public async deleteLabel(id: string): Promise<void> {
    await this.withImap(async (client) => {
      await client.mailboxDelete(id);
    });
  }

  public async getEmailAliases(): Promise<{ email: string; name?: string; primary?: boolean }[]> {
    return [{ email: this.config.auth.email, primary: true }];
  }

  public async revokeToken(_token: string): Promise<boolean> {
    return true;
  }

  public async deleteAllSpam(): Promise<DeleteAllSpamResponse> {
    return this.withImap(async (client) => {
      try {
        await client.mailboxOpen('Junk');
      } catch {
        return { success: true, message: 'Spam mailbox not found', count: 0 };
      }
      const uids = await client.search({});
      if (!uids.length) return { success: true, message: 'No spam emails to delete', count: 0 };
      for (const uid of uids) {
        await client.messageDelete(uid, { uid: true }).catch(() => undefined);
      }
      return { success: true, message: 'Deleted spam emails', count: uids.length };
    });
  }

  public async getRawEmail(id: string): Promise<string> {
    const uid = Number(id);
    if (!Number.isFinite(uid)) throw new Error('Invalid IMAP message id');
    return this.withImap(async (client) => {
      const found = await this.fetchByUidAcrossMailboxes(client, uid);
      if (!found?.msg?.source) throw new Error('Email not found');
      return this.sourceToString(found.msg.source);
    });
  }
}
