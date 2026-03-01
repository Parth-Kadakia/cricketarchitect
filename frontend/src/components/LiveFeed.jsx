import { useMemo } from 'react';

function numeric(value, fallback = 0) {
  const resolved = Number(value);
  return Number.isFinite(resolved) ? resolved : fallback;
}

export default function LiveFeed({ events, reverse = false, sortByBall = false, maxItems = 120 }) {
  const recentEvents = useMemo(() => {
    const items = (events || []).map((event, index) => {
      const payload = event.payload || {};
      const innings = numeric(payload.innings ?? event.innings);
      const over = numeric(payload.over ?? event.over ?? event.over_number);
      const ball = numeric(payload.ball ?? event.ball ?? event.ball_number);
      const timestamp = Date.parse(event.at || event.created_at || '');
      const phaseWeight = event.event === 'OVER_SUMMARY' ? 1 : 0;

      return {
        event,
        meta: {
          innings,
          over,
          ball,
          phaseWeight,
          timestamp: Number.isFinite(timestamp) ? timestamp : 0,
          index
        }
      };
    });

    if (sortByBall) {
      items.sort((a, b) => {
        if (a.meta.innings !== b.meta.innings) {
          return a.meta.innings - b.meta.innings;
        }

        if (a.meta.over !== b.meta.over) {
          return a.meta.over - b.meta.over;
        }

        if (a.meta.ball !== b.meta.ball) {
          return a.meta.ball - b.meta.ball;
        }

        if (a.meta.phaseWeight !== b.meta.phaseWeight) {
          return a.meta.phaseWeight - b.meta.phaseWeight;
        }

        if (a.meta.timestamp !== b.meta.timestamp) {
          return a.meta.timestamp - b.meta.timestamp;
        }

        return a.meta.index - b.meta.index;
      });
    } else {
      items.sort((a, b) => {
        if (a.meta.timestamp !== b.meta.timestamp) {
          return a.meta.timestamp - b.meta.timestamp;
        }

        return a.meta.index - b.meta.index;
      });
    }

    let ordered = items.map((item) => item.event);

    if (typeof maxItems === 'number' && Number.isFinite(maxItems) && maxItems > 0) {
      ordered = ordered.slice(-maxItems);
    }

    return reverse ? [...ordered].reverse() : ordered;
  }, [events, reverse, sortByBall, maxItems]);

  if (!recentEvents.length) {
    return <div className="empty-state">Live events will appear here during simulation.</div>;
  }

  return (
    <ul className="live-feed">
      {recentEvents.map((event, index) => (
        <li key={`${event.event}-${event.at || ''}-${event.payload?.innings || ''}-${event.payload?.over || ''}-${event.payload?.ball || ''}-${index}`}>
          <span className="live-feed-time">{event.at ? new Date(event.at).toLocaleTimeString() : '--:--'}</span>
          <span className="live-feed-event">
            {event.payload?.innings && event.payload?.over && event.payload?.ball
              ? `I${event.payload.innings} O${event.payload.over}.${event.payload.ball}`
              : event.event}
          </span>
          <p>{event.payload?.commentary || event.payload?.resultSummary || event.payload?.message || 'Update available.'}</p>
        </li>
      ))}
    </ul>
  );
}
