package za.kaapspoor.server;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;

/** A clock the tests can move. It starts at the real time so issued JWTs stay valid. */
public class MutableClock extends Clock {
    private volatile Instant now = Instant.now();

    public void reset() { now = Instant.now().truncatedTo(ChronoUnit.MILLIS); }
    public void advance(long seconds) { now = now.plusSeconds(seconds); }
    @Override public ZoneId getZone() { return ZoneOffset.UTC; }
    @Override public Clock withZone(ZoneId zone) { return this; }
    @Override public Instant instant() { return now; }
}
