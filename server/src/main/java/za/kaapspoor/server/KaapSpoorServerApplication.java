package za.kaapspoor.server;

import java.time.Clock;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;

@SpringBootApplication
public class KaapSpoorServerApplication {

    /** Injected wherever time matters, so tests can control it. */
    @Bean
    Clock clock() {
        return Clock.systemUTC();
    }

    public static void main(String[] args) {
        SpringApplication.run(KaapSpoorServerApplication.class, args);
    }
}
