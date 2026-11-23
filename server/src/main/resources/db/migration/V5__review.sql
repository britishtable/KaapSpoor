alter table route add column graded boolean not null default false;

alter table hike
    add column review_difficulty  text check (review_difficulty in ('EASIER','AS_GRADED','HARDER','EASY','MODERATE','HARD')),
    add column review_enjoyment   smallint check (review_enjoyment between 1 and 5),
    add column review_safety      text check (review_safety in ('YES','MOSTLY','NO')),
    add column review_safety_note text,
    add column review_navigation  text check (review_navigation in ('OBVIOUS','TRICKY_JUNCTIONS','GOT_LOST')),
    add column review_water       text check (review_water in ('NONE','SEASONAL','RELIABLE')),
    add column review_note        text;
