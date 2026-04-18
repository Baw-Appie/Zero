import type { DeleteAllSpamResponse, IOutgoingMessage, Label } from '../../types';
import type { CreateDraftData } from '../schemas';
import type { IGetThreadResponse, MailManager, ParsedDraft } from './types';

const notImplemented = (operation: string) => {
  throw new Error(`IMAP/SMTP operation "${operation}" is not implemented yet`);
};

export class ImapMailManager implements MailManager {
  constructor(public config: { auth: { userId: string; accessToken: string; refreshToken: string; email: string } }) {}

  public getScope(): string {
    return 'imap smtp';
  }

  public async getMessageAttachments() {
    return [];
  }

  public async get(): Promise<IGetThreadResponse> {
    return { messages: [], hasUnread: false, totalReplies: 0, labels: [] };
  }

  public async create(data: IOutgoingMessage): Promise<{ id?: string | null }> {
    void data;
    notImplemented('create');
  }

  public async sendDraft(id: string, data: IOutgoingMessage): Promise<void> {
    void id;
    void data;
    notImplemented('sendDraft');
  }

  public async createDraft(
    data: CreateDraftData,
  ): Promise<{ id?: string | null; success?: boolean; error?: string }> {
    void data;
    return { success: false, error: 'IMAP draft save is not implemented yet' };
  }

  public async getDraft(id: string): Promise<ParsedDraft> {
    void id;
    return { id: '' };
  }

  public async listDrafts(): Promise<{
    threads: { id: string; historyId: string | null; $raw: unknown }[];
    nextPageToken: string | null;
  }> {
    return { threads: [], nextPageToken: null };
  }

  public async delete(id: string): Promise<void> {
    void id;
  }

  public async deleteDraft(id: string): Promise<void> {
    void id;
  }

  public async list(): Promise<{
    threads: { id: string; historyId: string | null; $raw?: unknown }[];
    nextPageToken: string | null;
  }> {
    return { threads: [], nextPageToken: null };
  }

  public async count(): Promise<{ count?: number; label?: string }[]> {
    return [];
  }

  public async getTokens(): Promise<{
    tokens: { access_token?: string; refresh_token?: string; expiry_date?: number };
  }> {
    return { tokens: {} };
  }

  public async getUserInfo(): Promise<{ address: string; name: string; photo: string }> {
    return {
      address: this.config.auth.email,
      name: this.config.auth.email,
      photo: '',
    };
  }

  public async listHistory<T>(): Promise<{ history: T[]; historyId: string }> {
    return { history: [], historyId: '' };
  }

  public async markAsRead(threadIds: string[]): Promise<void> {
    void threadIds;
  }

  public async markAsUnread(threadIds: string[]): Promise<void> {
    void threadIds;
  }

  public normalizeIds(id: string[]): { threadIds: string[] } {
    return { threadIds: id };
  }

  public async modifyLabels(
    id: string[],
    options: { addLabels: string[]; removeLabels: string[] },
  ): Promise<void> {
    void id;
    void options;
  }

  public async getAttachment(messageId: string, attachmentId: string): Promise<string | undefined> {
    void messageId;
    void attachmentId;
    return undefined;
  }

  public async getUserLabels(): Promise<Label[]> {
    return [];
  }

  public async getLabel(id: string): Promise<Label> {
    return { id, name: id, type: 'user' };
  }

  public async createLabel(label: {
    name: string;
    color?: { backgroundColor: string; textColor: string };
  }): Promise<void> {
    void label;
  }

  public async updateLabel(
    id: string,
    label: { name: string; color?: { backgroundColor: string; textColor: string } },
  ): Promise<void> {
    void id;
    void label;
  }

  public async deleteLabel(id: string): Promise<void> {
    void id;
  }

  public async getEmailAliases(): Promise<{ email: string; name?: string; primary?: boolean }[]> {
    return [{ email: this.config.auth.email, primary: true }];
  }

  public async revokeToken(token: string): Promise<boolean> {
    void token;
    return true;
  }

  public async deleteAllSpam(): Promise<DeleteAllSpamResponse> {
    return { success: true, message: 'No spam mailbox configured for IMAP yet', count: 0 };
  }

  public async getRawEmail(id: string): Promise<string> {
    void id;
    return '';
  }
}
