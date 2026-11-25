import { TouchpointEvent, UnifiedProfile } from './types.js';
import { IdentityGraph } from './identity_graph.js';

export interface EnrichedEvent extends TouchpointEvent {
  profileId: string;
  isFirstTouch: boolean;
  isLastTouch: boolean;
}

export class RealtimeEventPipeline {
  private graph: IdentityGraph = new IdentityGraph();
  private profiles: Map<string, UnifiedProfile> = new Map();
  private eventHistory: Map<string, EnrichedEvent[]> = new Map(); // profileId -> events
  public metrics = {
    eventsIngested: 0,
    profilesCreated: 0,
    purchasesTracked: 0,
    totalRevenue: 0,
  };

  public ingestEvent(event: TouchpointEvent): EnrichedEvent {
    this.metrics.eventsIngested += 1;
    const profileId = this.graph.resolveIdentifiers(event.identifiers);

    let profile = this.profiles.get(profileId);
    let isFirstTouch = false;

    if (!profile) {
      isFirstTouch = true;
      this.metrics.profilesCreated += 1;
      profile = {
        profileId,
        identifiers: new Set(),
        firstSeen: event.timestamp,
        lastSeen: event.timestamp,
        eventCount: 0,
        lifetimeValue: 0,
      };
      this.profiles.set(profileId, profile);
    }

    // Update profile metadata
    for (const id of event.identifiers) {
      profile.identifiers.add(IdentityGraph.formatKey(id));
    }
    profile.lastSeen = Math.max(profile.lastSeen, event.timestamp);
    profile.firstSeen = Math.min(profile.firstSeen, event.timestamp);
    profile.eventCount += 1;

    if (event.eventType === 'PURCHASE') {
      const amount = Number(event.payload.amount) || 0;
      profile.lifetimeValue += amount;
      this.metrics.purchasesTracked += 1;
      this.metrics.totalRevenue += amount;
    }

    const enriched: EnrichedEvent = {
      ...event,
      profileId,
      isFirstTouch,
      isLastTouch: true,
    };

    if (!this.eventHistory.has(profileId)) {
      this.eventHistory.set(profileId, []);
    }
    const history = this.eventHistory.get(profileId)!;
    // previous event is no longer last touch
    if (history.length > 0) {
      history[history.length - 1].isLastTouch = false;
    }
    history.push(enriched);

    return enriched;
  }

  public getProfile(profileId: string): UnifiedProfile | null {
    return this.profiles.get(profileId) || null;
  }

  public getProfileEvents(profileId: string): EnrichedEvent[] {
    return this.eventHistory.get(profileId) || [];
  }
}
