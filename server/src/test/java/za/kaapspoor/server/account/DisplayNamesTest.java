package za.kaapspoor.server.account;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import za.kaapspoor.server.web.BadRequestException;

class DisplayNamesTest {

    @Test
    void unusableNamesAreBadRequests() {
        assertThatThrownBy(() -> DisplayNames.validate(null)).isInstanceOf(BadRequestException.class);
        assertThatThrownBy(() -> DisplayNames.validate("   ")).isInstanceOf(BadRequestException.class);
        assertThatThrownBy(() -> DisplayNames.validate("x".repeat(41)))
                .isInstanceOf(BadRequestException.class)
                .hasMessage("Display name must be at most 40 characters");
    }

    @Test
    void usableNameIsTrimmed() {
        assertThat(DisplayNames.validate("  Sam  ")).isEqualTo("Sam");
    }
}
