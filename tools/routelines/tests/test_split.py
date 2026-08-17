from kaap_routelines.graph import build_graph, split_ways
from kaap_routelines.ways import Way

A = (18.400, -34.000)
B = (18.410, -34.000)
C = (18.420, -34.000)
NORTH = (18.410, -33.990)


def w(osm_id: int, *points, name=None) -> Way:
    return Way(osm_id=osm_id, name=name, coords=tuple(points))


def test_a_way_with_no_junction_inside_it_is_left_alone():
    edges = split_ways([w(1, A, B, C)])
    assert [e.coords for e in edges] == [(A, B, C)]


def test_a_way_is_split_where_another_way_meets_it_mid_span():
    # THE defect this exists to fix. OSM does not cut a way at every junction:
    # a side path ending at B meets the through way at B, which is an INTERIOR
    # vertex of that way. Joining only at way endpoints missed 156,643 of the
    # 219,996 junctions in this extract and shattered the graph into 127,109
    # components, so nothing could reach anything.
    through = w(1, A, B, C)
    side = w(2, B, NORTH)
    edges = split_ways([through, side])
    assert sorted(len(e.coords) for e in edges) == [2, 2, 2]
    assert {e.osm_id for e in edges} == {1, 2}


def test_the_split_pieces_keep_the_name_and_id_of_their_way():
    edges = split_ways([w(1, A, B, C, name="Pipe Track"), w(2, B, NORTH)])
    pieces = [e for e in edges if e.osm_id == 1]
    assert len(pieces) == 2
    assert all(e.name == "Pipe Track" for e in pieces)


def test_splitting_makes_a_crossing_reachable():
    # Before the split these are two components and no walk crosses between
    # them; after it, one.
    ways = [w(1, A, B, C), w(2, B, NORTH)]
    assert len(build_graph(ways).components()) == 2
    assert len(build_graph(split_ways(ways)).components()) == 1


def test_a_shared_endpoint_still_joins():
    edges = split_ways([w(1, A, B), w(2, B, C)])
    assert len(build_graph(edges).components()) == 1


def test_a_repeated_vertex_inside_one_way_is_not_a_junction():
    # A way that touches its own path (a lollipop) shares a coordinate with
    # itself, not with another way. Counting appearances rather than distinct
    # ways would cut it there for no reason.
    edges = split_ways([w(1, A, B, C, B, NORTH)])
    assert len(edges) == 1
