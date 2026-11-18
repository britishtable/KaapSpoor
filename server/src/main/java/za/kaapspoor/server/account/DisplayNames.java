package za.kaapspoor.server.account;

import java.util.Locale;
import za.kaapspoor.server.web.BadRequestException;

public final class DisplayNames {

    static final int MAX_CODE_POINTS = 40;

    private DisplayNames() {}

    /** Returns the trimmed name, or throws {@link BadRequestException} (mapped to 400) if unusable. */
    public static String validate(String name) {
        if (name == null) {
            throw new BadRequestException("Display name is required");
        }
        String trimmed = name.trim();
        if (trimmed.isEmpty()) {
            throw new BadRequestException("Display name must not be blank");
        }
        if (trimmed.codePointCount(0, trimmed.length()) > MAX_CODE_POINTS) {
            throw new BadRequestException("Display name must be at most " + MAX_CODE_POINTS + " characters");
        }
        return trimmed;
    }

    /** First letter of each of the first two words, upper-cased: "sam van wyk" gives "SV". */
    public static String initials(String name) {
        StringBuilder out = new StringBuilder();
        int words = 0;
        for (String word : name.trim().split("\\s+")) {
            if (word.isEmpty() || words == 2) {
                continue;
            }
            out.appendCodePoint(word.codePointAt(0));
            words++;
        }
        return out.toString().toUpperCase(Locale.ROOT);
    }
}
