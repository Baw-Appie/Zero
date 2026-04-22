import { BaseSubscriptionFactory } from './base-subscription.factory';
import { EProviders } from '../../types';

// Provider factory registry
const subscriptionFactoryRegistry = new Map<EProviders, BaseSubscriptionFactory>();

export function getSubscriptionFactory(provider: EProviders): BaseSubscriptionFactory {
  const factory = subscriptionFactoryRegistry.get(provider);
  if (!factory) {
    throw new Error(`No subscription factory registered for provider: ${provider}`);
  }
  return factory;
}

export function getAllRegisteredProviders(): EProviders[] {
  return Array.from(subscriptionFactoryRegistry.keys());
}
