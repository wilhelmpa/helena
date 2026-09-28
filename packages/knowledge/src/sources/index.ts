import type { KnowledgeSource } from '@helena/sdk';
import { chatSource } from './chats';
import { agentMemorySource, agentSessionSource, factSource } from './helena-runtime';
import { commentSource, issueSource } from './issues';
import { mailSource } from './mail';
import { runSource } from './runs';
import { vaultSource } from './vault';

export {
  agentMemorySource,
  agentSessionSource,
  chatSource,
  commentSource,
  factSource,
  issueSource,
  mailSource,
  runSource,
  vaultSource,
};

// The sources Helena brings, in the order a search lists their kinds.
export function builtinKnowledgeSources(): KnowledgeSource[] {
  return [
    issueSource,
    vaultSource,
    mailSource,
    chatSource,
    runSource,
    commentSource,
    agentSessionSource,
    agentMemorySource,
    factSource,
  ];
}
