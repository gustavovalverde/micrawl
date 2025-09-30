declare module "user-agents" {
  type UserAgentFilter = unknown;

  export default class UserAgent {
    constructor(filter?: UserAgentFilter);
    random(): UserAgent;
    toString(): string;
    data: Record<string, unknown>;
  }
}
