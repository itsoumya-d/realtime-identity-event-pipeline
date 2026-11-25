import { describe, it, expect, beforeEach } from 'vitest';
import { IdentityGraph } from '../src/identity_graph.js';
import { RealtimeEventPipeline } from '../src/event_pipeline.js';
import { TouchpointEvent } from '../src/types.js';

describe('IdentityGraph', () => {
  let graph: IdentityGraph;

  beforeEach(() => {
    graph = new IdentityGraph();
  });

  it('resolves single identifier to a consistent profile ID', () => {
    const prof1 = graph.resolveIdentifiers([{ type: 'COOKIE_ID', value: 'ck_abc123' }]);
    const prof2 = graph.resolveIdentifiers([{ type: 'COOKIE_ID', value: 'ck_abc123' }]);
    expect(prof1).toBe(prof2);
    expect(prof1).toMatch(/^prof_\d+$/);
  });

  it('transitively clusters multiple touchpoint identifiers', () => {
    // Touchpoint 1: Cookie A + Email X
    const p1 = graph.resolveIdentifiers([
      { type: 'COOKIE_ID', value: 'ck_01' },
      { type: 'EMAIL_HASH', value: 'sha_user1@domain.com' },
    ]);

    // Touchpoint 2: Mobile Device D1 + Cookie A
    const p2 = graph.resolveIdentifiers([
      { type: 'DEVICE_ID', value: 'dev_mobile_01' },
      { type: 'COOKIE_ID', value: 'ck_01' },
    ]);

    // Touchpoint 3: Authenticated User ID + Device D1
    const p3 = graph.resolveIdentifiers([
      { type: 'USER_ID', value: 'usr_9999' },
      { type: 'DEVICE_ID', value: 'dev_mobile_01' },
    ]);

    // All should resolve to the exact same canonical profile
    expect(p1).toBe(p2);
    expect(p2).toBe(p3);

    expect(graph.getProfileId({ type: 'EMAIL_HASH', value: 'sha_user1@domain.com' })).toBe(p1);
    expect(graph.getProfileId({ type: 'USER_ID', value: 'usr_9999' })).toBe(p1);
  });
});

describe('RealtimeEventPipeline', () => {
  let pipeline: RealtimeEventPipeline;

  beforeEach(() => {
    pipeline = new RealtimeEventPipeline();
  });

  it('ingests multichannel events and attributes first-touch & last-touch correctly', () => {
    const t0 = 1700000000000;

    // Event 1: Anonymous Web page view
    const ev1: TouchpointEvent = {
      eventId: 'evt_001',
      timestamp: t0,
      channel: 'WEB',
      eventType: 'PAGE_VIEW',
      identifiers: [{ type: 'COOKIE_ID', value: 'cookie_alpha' }],
      payload: { url: '/products/laptop' },
    };
    const res1 = pipeline.ingestEvent(ev1);
    expect(res1.isFirstTouch).toBe(true);
    expect(res1.isLastTouch).toBe(true);

    // Event 2: Email Click from newsletter
    const ev2: TouchpointEvent = {
      eventId: 'evt_002',
      timestamp: t0 + 60000,
      channel: 'EMAIL',
      eventType: 'CLICK',
      identifiers: [
        { type: 'COOKIE_ID', value: 'cookie_alpha' },
        { type: 'EMAIL_HASH', value: 'hash_buyer@test.de' },
      ],
      payload: { campaign: 'black_friday' },
    };
    const res2 = pipeline.ingestEvent(ev2);
    expect(res2.profileId).toBe(res1.profileId);
    expect(res2.isFirstTouch).toBe(false);
    expect(res2.isLastTouch).toBe(true);

    // Event 3: Mobile Purchase with User Login
    const ev3: TouchpointEvent = {
      eventId: 'evt_003',
      timestamp: t0 + 120000,
      channel: 'MOBILE',
      eventType: 'PURCHASE',
      identifiers: [
        { type: 'USER_ID', value: 'user_1001' },
        { type: 'EMAIL_HASH', value: 'hash_buyer@test.de' },
      ],
      payload: { amount: 249.99, currency: 'EUR' },
    };
    const res3 = pipeline.ingestEvent(ev3);
    expect(res3.profileId).toBe(res1.profileId);
    expect(res3.isLastTouch).toBe(true);

    // Check Profile aggregates
    const profile = pipeline.getProfile(res1.profileId);
    expect(profile).not.toBeNull();
    expect(profile!.eventCount).toBe(3);
    expect(profile!.lifetimeValue).toBeCloseTo(249.99);
    expect(profile!.identifiers.size).toBe(3); // COOKIE, EMAIL, USER_ID

    // Check pipeline metrics
    expect(pipeline.metrics.eventsIngested).toBe(3);
    expect(pipeline.metrics.profilesCreated).toBe(1);
    expect(pipeline.metrics.purchasesTracked).toBe(1);
    expect(pipeline.metrics.totalRevenue).toBeCloseTo(249.99);

    // Verify first event updated lastTouch flag
    const history = pipeline.getProfileEvents(res1.profileId);
    expect(history[0].isLastTouch).toBe(false);
    expect(history[1].isLastTouch).toBe(false);
    expect(history[2].isLastTouch).toBe(true);
  });
});

describe('Edge Cases and Scale', () => {
  it('throws on empty identifier array', () => {
    const graph = new IdentityGraph();
    expect(() => graph.resolveIdentifiers([])).toThrow('At least one identifier required');
  });

  it('maintains distinct profiles for unconnected identifiers', () => {
    const graph = new IdentityGraph();
    const p1 = graph.resolveIdentifiers([{ type: 'USER_ID', value: 'user_A' }]);
    const p2 = graph.resolveIdentifiers([{ type: 'USER_ID', value: 'user_B' }]);
    expect(p1).not.toBe(p2);
  });

  it('aggregates high-volume touchpoints under a single profile', () => {
    const pipeline = new RealtimeEventPipeline();
    const cookie = { type: 'COOKIE_ID' as const, value: 'ck_stress_test' };
    const baseTime = 1700000000000;

    for (let i = 0; i < 50; i++) {
      pipeline.ingestEvent({
        eventId: `ev_${i}`,
        timestamp: baseTime + (i * 1000),
        channel: 'WEB',
        eventType: i % 10 === 0 ? 'PURCHASE' : 'PAGE_VIEW',
        identifiers: [cookie],
        payload: { amount: i % 10 === 0 ? 50 : 0 },
      });
    }

    const profId = pipeline.ingestEvent({
      eventId: 'final_ev',
      timestamp: baseTime + 100000,
      channel: 'WEB',
      eventType: 'PAGE_VIEW',
      identifiers: [cookie],
      payload: {},
    }).profileId;

    const profile = pipeline.getProfile(profId);
    expect(profile).not.toBeNull();
    expect(profile!.eventCount).toBe(51);
    expect(profile!.lifetimeValue).toBe(250); // 5 purchases * 50
    expect(pipeline.getProfileEvents(profId).length).toBe(51);
  });
});
