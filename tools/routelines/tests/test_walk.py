from kaap_routelines.graph import build_graph
from kaap_routelines.trails import build_trails
from kaap_routelines.walk import Rejected, WalkResult, walk_route
from kaap_routelines.ways import Way

# A west-to-east chain of nodes ~90 m apart at this latitude.
P = [(18.400 + 0.001 * i, -34.000) for i in range(12)]


def w(osm_id: int, a, b, name=None) -> Way:
    return Way(osm_id=osm_id, name=name, coords=(a, b))


def _world(ways):
    trails = build_trails(ways, [])
    return trails, build_graph(ways)


def test_walks_two_named_trails_in_prose_order():
    ways = [
        w(1, P[0], P[1], name="First Path"),
        w(2, P[1], P[2], name="First Path"),
        w(3, P[2], P[3], name="Second Path"),
    ]
    trails, graph = _world(ways)
    result = walk_route(P[0], ["First Path", "Second Path"], trails, graph)
    assert isinstance(result, WalkResult)
    assert result.way_ids == (1, 2, 3)
    assert result.coords[0] == P[0]
    assert result.coords[-1] == P[3]


def test_follows_a_trail_to_its_far_end_rather_than_clipping_its_corner():
    # The route joins First Path at its start and must walk its whole length,
    # not touch it and leave. This is the difference between a route and a
    # shortest path that happens to graze one.
    ways = [
        w(1, P[0], P[1], name="First Path"),
        w(2, P[1], P[2], name="First Path"),
        w(3, P[2], P[3], name="Second Path"),
    ]
    trails, graph = _world(ways)
    result = walk_route(P[0], ["First Path", "Second Path"], trails, graph)
    assert isinstance(result, WalkResult)
    assert 2 in result.way_ids


def test_an_unnamed_connector_bridges_a_gap():
    # Five named segments around one unnamed bridge: ~17 % connector, inside
    # the 20 % cap. The named trails have to be longer than the bridge for this
    # to be the case being tested at all — with one segment each, a single
    # connector is a third of the line and the cap below rejects it, which is
    # the cap working rather than the connector failing.
    ways = [
        w(1, P[0], P[1], name="First Path"),
        w(10, P[1], P[2], name="First Path"),
        w(2, P[2], P[3]),  # unnamed connector
        w(3, P[3], P[4], name="Second Path"),
        w(11, P[4], P[5], name="Second Path"),
        w(12, P[5], P[6], name="Second Path"),
    ]
    trails, graph = _world(ways)
    result = walk_route(P[0], ["First Path", "Second Path"], trails, graph)
    assert isinstance(result, WalkResult)
    assert result.connector_m > 0
    assert 2 in result.way_ids


def test_a_long_connector_is_rejected_by_the_fraction_cap():
    # 8 unnamed segments between two short named ones: the walk is mostly
    # unrelated trail, which is evidence the prose order was not a route order.
    ways = [w(1, P[0], P[1], name="First Path")]
    ways += [w(10 + i, P[1 + i], P[2 + i]) for i in range(8)]
    ways += [w(2, P[9], P[10], name="Second Path")]
    trails, graph = _world(ways)
    result = walk_route(P[0], ["First Path", "Second Path"], trails, graph)
    assert isinstance(result, Rejected)
    assert "connector" in result.reason


def test_an_anchor_far_from_any_path_is_rejected():
    ways = [w(1, P[0], P[1], name="First Path"), w(2, P[1], P[2], name="Second Path")]
    trails, graph = _world(ways)
    result = walk_route((18.6, -34.0), ["First Path", "Second Path"], trails, graph)
    assert isinstance(result, Rejected)
    assert "anchor" in result.reason


def test_an_unreachable_second_trail_is_rejected():
    ways = [
        w(1, P[0], P[1], name="First Path"),
        w(2, (18.7, -34.0), (18.71, -34.0), name="Second Path"),
    ]
    trails, graph = _world(ways)
    result = walk_route(P[0], ["First Path", "Second Path"], trails, graph)
    assert isinstance(result, Rejected)
    assert "reach" in result.reason


def test_a_name_with_no_trail_at_all_is_rejected():
    ways = [w(1, P[0], P[1], name="First Path")]
    trails, graph = _world(ways)
    result = walk_route(P[0], ["First Path", "Nowhere Path"], trails, graph)
    assert isinstance(result, Rejected)
    assert "unknown" in result.reason


def test_a_single_mention_on_one_connected_run_yields_a_line():
    # No ordering claim to get wrong: one trail, identified and located.
    ways = [w(1, P[0], P[1], name="Only Path"), w(2, P[1], P[2], name="Only Path")]
    trails, graph = _world(ways)
    result = walk_route(P[0], ["Only Path"], trails, graph)
    assert isinstance(result, WalkResult)
    assert result.way_ids == (1, 2)


def test_a_single_mention_split_across_disjoint_runs_is_rejected():
    ways = [
        w(1, P[0], P[1], name="Only Path"),
        w(2, (18.7, -34.0), (18.71, -34.0), name="Only Path"),
    ]
    trails, graph = _world(ways)
    result = walk_route(P[0], ["Only Path"], trails, graph)
    assert isinstance(result, Rejected)
    assert "runs" in result.reason


def test_no_names_is_rejected():
    trails, graph = _world([w(1, P[0], P[1], name="First Path")])
    result = walk_route(P[0], [], trails, graph)
    assert isinstance(result, Rejected)
    assert "names" in result.reason
