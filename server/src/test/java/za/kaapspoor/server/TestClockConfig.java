package za.kaapspoor.server;

import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;

/** Replaces the application Clock with a {@link MutableClock}. */
@TestConfiguration
public class TestClockConfig {
    @Bean
    @Primary
    public MutableClock testClock() {
        return new MutableClock();
    }
}
