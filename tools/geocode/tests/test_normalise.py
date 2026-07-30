from __future__ import annotations

from kaap_geocode.normalise import candidates, comparison_key


def test_comparison_key_lowercases_and_drops_punctuation():
    assert comparison_key("Lion's Head") == "lions head"
    assert comparison_key("Carrel's  Ledge") == "carrels ledge"


def test_comparison_key_expands_abbreviations():
    assert comparison_key("Elsies Pk") == "elsies peak"
    assert comparison_key("Mt Zebra Park") == "mount zebra park"


def test_comparison_key_normalises_afrikaans_english_variants():
    # The wiki says "Long Kloof"; OSM says "Lang Kloof".
    assert comparison_key("Long Kloof") == comparison_key("Lang Kloof")


def test_candidates_start_with_the_cleaned_full_title():
    assert candidates("Newlands Ravine")[0] == "Newlands Ravine"


def test_candidates_strip_parentheticals_and_quoted_nicknames():
    got = candidates("Lion's Head B (Twirly-Whirly route)")
    assert "Lion's Head B" in got
    assert "Lion's Head" in got
    # Most specific first: the parenthetical-stripped form precedes the
    # letter-variant-stripped one.
    assert got.index("Lion's Head B") < got.index("Lion's Head")


def test_candidates_strip_a_leading_quoted_nickname():
    got = candidates("'Skywalk' - Right Face to Platteklip")
    assert "Right Face to Platteklip" in got


def test_candidates_strip_trailing_route_vocabulary():
    assert "Elsies Pk" in candidates("Elsies Pk Circular Rte")
    assert "Constantiaberg" in candidates("Constantiaberg North West route")


def test_candidates_keep_feature_type_words():
    # "Buttress", "Ravine", "Kloof", "Gully" are part of the OSM name, not route
    # vocabulary, so they must survive.
    got = candidates("Nursery Buttress")
    assert got[0] == "Nursery Buttress"
    assert "Nursery" not in got


def test_candidates_are_unique_and_non_empty():
    got = candidates("Otter Trail")
    assert got == list(dict.fromkeys(got))
    assert all(c.strip() for c in got)
    # "Otter Trail" is itself the OSM name, so the full title must be tried first.
    assert got[0] == "Otter Trail"


def test_candidates_truncate_at_a_direction_word_before_a_feature_type_word():
    # "Buttress" is part of the OSM name and stays, but "Eastern" describes the
    # approach — without truncation this title could never reach "Devils Peak".
    got = candidates("Devils Peak Eastern Buttress")
    assert got[0] == "Devils Peak Eastern Buttress"
    assert "Devils Peak" in got
    assert got.index("Devils Peak Eastern Buttress") < got.index("Devils Peak")


def test_candidates_truncate_at_a_multiword_direction_run():
    assert "Lion's Head" in candidates("Lion's Head South East Arête")
    assert "Sentinel" in candidates("Sentinel SE Ridge")


def test_candidates_truncate_at_a_connective():
    assert "Devils Peak" in candidates("Devils Peak via the Saddle")


def test_truncation_never_empties_a_title_that_starts_with_a_direction_word():
    got = candidates("North Face Traverse")
    assert all(c.strip() for c in got)
    assert got[0] == "North Face Traverse"


def test_truncation_leaves_a_title_with_no_direction_or_connective_alone():
    assert candidates("Nursery Buttress") == ["Nursery Buttress"]
