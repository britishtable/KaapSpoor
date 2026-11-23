package za.kaapspoor.server.hike;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import za.kaapspoor.server.hike.ReviewAnswers.Difficulty;
import za.kaapspoor.server.hike.ReviewAnswers.Navigation;
import za.kaapspoor.server.hike.ReviewAnswers.Safety;
import za.kaapspoor.server.hike.ReviewAnswers.Water;

/** Columns of the hike row. Hibernate reads an all-null embedded value as null, which is "no review". */
@Embeddable
public class HikeReview {

    @Enumerated(EnumType.STRING)
    @Column(name = "review_difficulty")
    private Difficulty difficulty;

    @JdbcTypeCode(SqlTypes.SMALLINT)
    @Column(name = "review_enjoyment")
    private Integer enjoyment;

    @Enumerated(EnumType.STRING)
    @Column(name = "review_safety")
    private Safety safety;

    @Column(name = "review_safety_note")
    private String safetyNote;

    @Enumerated(EnumType.STRING)
    @Column(name = "review_navigation")
    private Navigation navigation;

    @Enumerated(EnumType.STRING)
    @Column(name = "review_water")
    private Water water;

    @Column(name = "review_note")
    private String note;

    protected HikeReview() {}

    public HikeReview(Difficulty difficulty, Integer enjoyment, Safety safety, String safetyNote,
                      Navigation navigation, Water water, String note) {
        this.difficulty = difficulty;
        this.enjoyment = enjoyment;
        this.safety = safety;
        this.safetyNote = safetyNote;
        this.navigation = navigation;
        this.water = water;
        this.note = note;
    }

    public Difficulty getDifficulty() { return difficulty; }
    public Integer getEnjoyment() { return enjoyment; }
    public Safety getSafety() { return safety; }
    public String getSafetyNote() { return safetyNote; }
    public Navigation getNavigation() { return navigation; }
    public Water getWater() { return water; }
    public String getNote() { return note; }
}
