import { Component, type ReactNode } from 'react';

export default class VaultMarkdownBoundary extends Component<
  {
    children: ReactNode;
    fallback: ReactNode;
    onError: () => void;
  },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onError();
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
