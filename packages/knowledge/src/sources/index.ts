import type { KnowledgeSource } from '@helena/sdk';
import { chatSource } from './chats';
import { commentSource, issueSource } from './issues';
import { mailSource } from './mail';
import { runSource } from './runs';
import { vaultSource } from './vault';

export { chatSource, commentSource, issueSource, mailSource, runSource, vaultSource };

// The sources Helena brings, in the order a search lists their kinds.
export function builtinKnowledgeSources(): KnowledgeSource[] {
  return [issueSource, vaultSource, mailSource, chatSource, runSource, commentSource];
}
