from kaap_routelines.report import build_report, Outcome, Proposal


def test_lists_accepted_lines_with_their_evidence():
    outcome = Outcome(
        accepted=[
            {"routeId": "a--b--platteklip", "source": "osm-relation", "lengthM": 2400.0,
             "connectorM": 0.0, "ways": 4, "relation": 2934380},
        ],
        rejected=[],
        proposals=[],
    )
    text = build_report(outcome, extract_date="2026-08-16")
    assert "a--b--platteklip" in text
    assert "osm-relation" in text
    assert "2.4 km" in text


def test_states_every_rejection_and_its_reason():
    outcome = Outcome(
        accepted=[],
        rejected=[{"routeId": "a--b--c", "reason": "anchor: no path within 250 m of the position"}],
        proposals=[],
    )
    text = build_report(outcome, extract_date="2026-08-16")
    assert "a--b--c" in text
    assert "no path within 250 m" in text


def test_proposals_are_marked_as_questions_not_answers():
    outcome = Outcome(
        accepted=[],
        rejected=[],
        proposals=[Proposal(route_id="a--b--c", title="Devil's Peak contour paths",
                            relation_id=2934370, relation_name="Contour Path")],
    )
    text = build_report(outcome, extract_date="2026-08-16")
    assert "Contour Path" in text
    assert "data/route-relations.json" in text
