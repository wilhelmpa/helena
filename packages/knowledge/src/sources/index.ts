import type { KnowledgeSource } from '@helena/sdk';
import { chatSource } from './chats';
import { commentSource, issueSource } from './issues';
import { mailSource } from './mail';
import { initiativeSource } from './initiatives';
import { goalSource } from './goals';
import { receiptSource } from './receipts';
import { runSource } from './runs';
import { vaultSource } from './vault';

export {
  chatSource,
  commentSource,
  issueSource,
  goalSource,
  initiativeSource,
  mailSource,
  receiptSource,
  runSource,
  vaultSource,
};

// The sources Helena brings, in the order a search lists their kinds.
export function builtinKnowledgeSources(): KnowledgeSource[] {
  return [
    issueSource,
    goalSource,
    initiativeSource,
    vaultSource,
    receiptSource,
    mailSource,
    chatSource,
    runSource,
    commentSource,
  ];
}
