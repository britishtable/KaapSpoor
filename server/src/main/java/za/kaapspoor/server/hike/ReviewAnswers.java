package za.kaapspoor.server.hike;

/** The answers a hike review can carry. Names are stored as text, so they are part of the schema. */
public final class ReviewAnswers {

    private ReviewAnswers() {}

    public enum Difficulty {
        EASIER, AS_GRADED, HARDER, EASY, MODERATE, HARD;

        /** True for the scale shown against a graded route; false for the ungraded one. */
        public boolean isGradedScale() {
            return this == EASIER || this == AS_GRADED || this == HARDER;
        }
    }

    public enum Safety { YES, MOSTLY, NO }

    public enum Navigation { OBVIOUS, TRICKY_JUNCTIONS, GOT_LOST }

    public enum Water { NONE, SEASONAL, RELIABLE }
}
