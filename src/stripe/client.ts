import Stripe from 'stripe';
import jwt from 'jsonwebtoken';
import { config } from '../lib/config';

export class StripeClient {
  private stripe: Stripe;
  private cache = new Map<string, { tier: string; expires: number }>();

  constructor() {
    if (!config.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY is required');
    }
    
    this.stripe = new Stripe(config.STRIPE_SECRET_KEY, {
      apiVersion: '2025-07-30.basil'
    });
  }

  async verifySubscription(email: string): Promise<{ tier: 'free' | 'pro'; token?: string }> {
    try {
      // Check cache first
      const cached = this.cache.get(email);
      if (cached && cached.expires > Date.now()) {
        if (cached.tier === 'pro') {
          const token = this.generateJWT(email, 'pro');
          return { tier: 'pro', token };
        }
        return { tier: 'free' };
      }

      // Search for customer by email
      const customers = await this.stripe.customers.list({
        email: email,
        limit: 1
      });

      if (customers.data.length === 0) {
        this.cacheResult(email, 'free');
        return { tier: 'free' };
      }

      const customer = customers.data[0];
      
      // Check for active subscriptions
      const subscriptions = await this.stripe.subscriptions.list({
        customer: customer.id,
        status: 'active',
        price: config.STRIPE_PRICE_ID,
        limit: 1
      });

      if (subscriptions.data.length > 0) {
        this.cacheResult(email, 'pro');
        const token = this.generateJWT(email, 'pro');
        return { tier: 'pro', token };
      }

      this.cacheResult(email, 'free');
      return { tier: 'free' };

    } catch (error) {
      console.error('Error verifying subscription:', error);
      return { tier: 'free' };
    }
  }

  async handleWebhook(body: string, signature: string): Promise<void> {
    try {
      const event = this.stripe.webhooks.constructEvent(
        body,
        signature,
        config.STRIPE_WEBHOOK_SECRET
      );

      switch (event.type) {
        case 'checkout.session.completed':
          await this.handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
          break;
        
        case 'customer.subscription.updated':
        case 'customer.subscription.deleted':
          await this.handleSubscriptionChange(event.data.object as Stripe.Subscription);
          break;
        
        default:
          console.log(`Unhandled event type: ${event.type}`);
      }
    } catch (error) {
      console.error('Webhook error:', error);
      throw error;
    }
  }

  private async handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
    if (session.customer_email) {
      // Clear cache for this customer to force refresh
      this.cache.delete(session.customer_email);
      console.log(`Checkout completed for ${session.customer_email}`);
    }
  }

  private async handleSubscriptionChange(subscription: Stripe.Subscription): Promise<void> {
    try {
      // Get customer email
      const customer = await this.stripe.customers.retrieve(subscription.customer as string);
      
      if (customer && !customer.deleted && customer.email) {
        // Clear cache to force refresh
        this.cache.delete(customer.email);
        console.log(`Subscription changed for ${customer.email}: ${subscription.status}`);
      }
    } catch (error) {
      console.error('Error handling subscription change:', error);
    }
  }

  private generateJWT(email: string, tier: 'free' | 'pro'): string {
    const payload = { 
      email, 
      tier,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24 hours
    };
    
    return jwt.sign(payload, config.JWT_SECRET);
  }

  private cacheResult(email: string, tier: string): void {
    this.cache.set(email, {
      tier,
      expires: Date.now() + (config.CACHE_TTL_SECONDS * 1000)
    });
  }

  // Method to clear cache entry (useful for testing)
  clearCache(email: string): void {
    this.cache.delete(email);
  }

  // Method to get cache stats (useful for monitoring)
  getCacheStats(): { size: number; entries: string[] } {
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.keys())
    };
  }
}

// Singleton instance
export const stripeClient = new StripeClient();

