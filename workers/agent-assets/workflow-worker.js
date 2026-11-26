import { WorkflowEntrypoint } from 'cloudflare:workers';
import { runResearchJob } from './research-workflow.js';
export { default } from './worker.js';

export class SlinkAgentResearch extends WorkflowEntrypoint {
  async run(event, step) {
    // No HTTP route exposes this entry point. Cloudflare authorizes instance creation.
    return step.do('research-result', { retries: { limit: 0, delay: '1 second' }, timeout: '4 minutes' },
      () => runResearchJob(event.payload, this.env));
  }
}
