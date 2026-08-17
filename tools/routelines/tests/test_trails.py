from kaap_routelines.relations import Member, Relation
from kaap_routelines.trails import build_trails, runs
from kaap_routelines.ways import Way

A = (18.400, -34.000)
B = (18.410, -34.000)
C = (18.420, -34.000)
FAR = (18.500, -34.000)
FAR2 = (18.510, -34.000)


def w(osm_id: int, *points, name=None) -> Way:
    return Way(osm_id=osm_id, name=name, coords=tuple(points))


def test_a_trail_is_built_from_ways_carrying_the_name():
    trails = build_trails([w(1, A, B, name="Pipe Track"), w(2, B, C)], [])
    assert set(trails) == {"Pipe Track"}
    assert trails["Pipe Track"].source == "name"
    assert [way.osm_id for way in trails["Pipe Track"].ways] == [1]


def test_a_relation_supplies_the_trail_instead_and_brings_its_connectors():
    # The whole point: way 2 carries no name, so name-matching cannot see it,
    # and the trail is two disjoint pieces with a hole in the middle. The
    # relation lists it, so the relation-backed trail is continuous.
    named_a = w(1, A, B, name="Contour Path")
    connector = w(2, B, C)
    named_b = w(3, C, (18.430, -34.0), name="Contour Path")
    relation = Relation(
        osm_id=2934370,
        name="Contour Path",
        members=(Member(named_a, ""), Member(connector, ""), Member(named_b, "")),
    )
    trails = build_trails([named_a, connector, named_b], [relation])
    trail = trails["Contour Path"]
    assert trail.source == "relation"
    assert [way.osm_id for way in trail.ways] == [1, 2, 3]
    assert len(runs(trail)) == 1


def test_a_name_matched_trail_reports_its_disjoint_runs():
    trails = build_trails(
        [w(1, A, B, name="Ledges"), w(2, FAR, FAR2, name="Ledges")], []
    )
    assert len(runs(trails["Ledges"])) == 2


def test_runs_of_a_connected_trail_is_one_run():
    trails = build_trails([w(1, A, B, name="X"), w(2, B, C, name="X")], [])
    assert len(runs(trails["X"])) == 1
