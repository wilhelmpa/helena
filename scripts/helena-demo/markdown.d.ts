// The agent pool imports its self-written skills as text (`import md from './SKILL.md' with
// { type: 'text' }`); the demo seed reaches the pool through the pool setup, so the scripts'
// typecheck needs to know what such an import is.
declare module '*.md' {
  const content: string;
  export default content;
}
