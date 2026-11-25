export type IdentifierType = 'COOKIE_ID' | 'EMAIL_HASH' | 'USER_ID' | 'DEVICE_ID';

export interface Identifier {
  type: IdentifierType;
  value: string;
}

export type ChannelType = 'WEB' | 'MOBILE' | 'EMAIL';
export type EventType = 'PAGE_VIEW' | 'CLICK' | 'PURCHASE' | 'OPEN';

export interface TouchpointEvent {
  eventId: string;
  timestamp: number;
  channel: ChannelType;
  eventType: EventType;
  identifiers: Identifier[];
  payload: Record<string, any>;
}

export interface UnifiedProfile {
  profileId: string;
  identifiers: Set<string>; // formatted as 'type:value'
  firstSeen: number;
  lastSeen: number;
  eventCount: number;
  lifetimeValue: number;
}
