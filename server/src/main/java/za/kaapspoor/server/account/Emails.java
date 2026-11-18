package za.kaapspoor.server.account;

import java.util.Locale;

public final class Emails {

    private Emails() {}

    /** Trimmed and lower-cased; the form stored and looked up everywhere. */
    public static String normalise(String email) {
        return email.trim().toLowerCase(Locale.ROOT);
    }
}
