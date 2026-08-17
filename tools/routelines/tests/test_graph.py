from kaap_routelines.graph import build_graph
from kaap_routelines.geo import node_key
from kaap_routelines.ways import Way

A = (18.400, -34.000)
B = (18.410, -34.000)
C = (18.420, -34.000)
FAR = (18.500, -34.000)


def w(osm_id: int, *points, name=None) -> Way:
    return Way(osm_id=osm_id, name=name, coords=tuple(points))


def test_two_ways_meeting_at_a_node_are_one_component():
    # THE load-bearing assumption of this whole tier. If the join key ever
    # stops working, the graph shatters into singletons and every stitched
    # route silently disappears — with no error anywhere.
    graph = build_graph([w(1, A, B), w(2, B, C)])
    assert len(graph.components()) == 1


def test_ways_that_do_not_meet_are_separate_components():
    graph = build_graph([w(1, A, B), w(2, FAR, (18.51, -34.0))])
    assert len(graph.components()) == 2


def test_shortest_path_walks_across_a_join():
    graph = build_graph([w(1, A, B), w(2, B, C)])
    result = graph.shortest_path(node_key(A), {node_key(C)})
    assert result is not None
    assert [way.osm_id for way in result.ways] == [1, 2]
    assert result.end == node_key(C)
    assert result.length_m > 0


def test_shortest_path_prefers_the_shorter_of_two_routes():
    # A->C directly, or A->B->C the long way round.
    direct = w(3, A, C)
    graph = build_graph([w(1, A, (18.405, -34.05)), w(2, (18.405, -34.05), C), direct])
    result = graph.shortest_path(node_key(A), {node_key(C)})
    assert result is not None
    assert [way.osm_id for way in result.ways] == [3]


def test_shortest_path_returns_none_when_unreachable():
    graph = build_graph([w(1, A, B), w(2, FAR, (18.51, -34.0))])
    assert graph.shortest_path(node_key(A), {node_key(FAR)}) is None


def test_shortest_path_to_the_start_is_empty_and_free():
    graph = build_graph([w(1, A, B)])
    result = graph.shortest_path(node_key(A), {node_key(A)})
    assert result is not None
    assert result.ways == ()
    assert result.length_m == 0.0


def test_nearest_node_within_radius():
    graph = build_graph([w(1, A, B)])
    # ~90 m east of A at this latitude.
    assert graph.nearest_node((18.401, -34.000), 250) == node_key(A)


def test_nearest_node_returns_none_beyond_the_radius():
    graph = build_graph([w(1, A, B)])
    assert graph.nearest_node((18.500, -34.000), 250) is None
