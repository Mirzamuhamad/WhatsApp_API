import axios from 'axios';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { listWebhooks } from './sessionRepository.js';

export class WebhookService {
  async dispatch(event, payload) {
    const webhooks = await listWebhooks();
    const active = webhooks.filter((webhook) => {
      const events = Array.isArray(webhook.events) ? webhook.events : [];
      return webhook.status === 'active' && (events.length === 0 || events.includes(event));
    });

    await Promise.allSettled(
      active.map((webhook) =>
        axios.post(
          webhook.url,
          {
            event,
            payload,
            sent_at: new Date().toISOString()
          },
          { timeout: config.webhook.timeoutMs }
        )
      )
    ).then((results) => {
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          logger.warn(
            { webhook: active[index]?.url, error: result.reason?.message },
            'Webhook dispatch failed'
          );
        }
      });
    });
  }
}
