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
    # Nearby but not connected — 1 km north, sharing no node. Distance is not
    # what makes this unreachable, which is the point: a trail far enough away
    # to be a different trail entirely is skipped by the range gate instead.
    ways = [
        w(1, P[0], P[1], name="First Path"),
        w(2, (18.410, -33.990), (18.420, -33.990), name="Second Path"),
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
    # Both runs near the route and unconnected: proximity cannot say which one
    # the route walks, and one name gives no ordering to say either.
    ways = [
        w(1, P[0], P[1], name="Only Path"),
        w(2, (18.410, -33.990), (18.420, -33.990), name="Only Path"),
    ]
    trails, graph = _world(ways)
    result = walk_route(P[0], ["Only Path"], trails, graph)
    assert isinstance(result, Rejected)
    assert "runs" in result.reason


def test_ignores_a_trail_of_that_name_far_from_the_route():
    # `Traverse` is a real OSM path name 111 km away, and the matcher sees the
    # word in "7 Buttresses Apostles Traverse". Before this rule that one
    # spurious name made the whole route unreachable and it drew nothing. The
    # gate is distance, not word count: `Echo Valley` is two words and 18 km
    # from the route that mentions it.
    ways = [
        w(1, P[0], P[1], name="First Path"),
        w(2, P[1], P[2], name="Second Path"),
        w(3, (19.5, -34.0), (19.51, -34.0), name="Traverse"),
    ]
    trails, graph = _world(ways)
    result = walk_route(P[0], ["First Path", "Traverse", "Second Path"], trails, graph)
    assert isinstance(result, WalkResult)
    assert result.way_ids == (1, 2)


def test_a_route_whose_every_name_is_far_away_is_rejected():
    # The route is anchored perfectly well — there is path under its feet. The
    # only trail its description names is 100 km away, so there is nothing to
    # draw and the reason says so rather than blaming the anchor.
    ways = [
        w(1, P[0], P[1]),
        w(2, (19.5, -34.0), (19.51, -34.0), name="Traverse"),
    ]
    trails, graph = _world(ways)
    result = walk_route(P[0], ["Traverse"], trails, graph)
    assert isinstance(result, Rejected)
    assert "range" in result.reason


def test_takes_the_run_nearest_the_route_not_the_longest():
    # Contour Path is 9 disjoint runs in this extract. The longest is not the
    # one this route walks; the nearest is.
    near = [w(1, P[0], P[1], name="Contour Path")]
    far = [
        w(10, (18.60 + 0.001 * i, -34.0), (18.60 + 0.001 * (i + 1), -34.0), name="Contour Path")
        for i in range(6)
    ]
    trails, graph = _world(near + far)
    result = walk_route(P[0], ["Contour Path"], trails, graph)
    assert isinstance(result, WalkResult)
    assert result.way_ids == (1,)


def test_no_names_is_rejected():
    trails, graph = _world([w(1, P[0], P[1], name="First Path")])
    result = walk_route(P[0], [], trails, graph)
    assert isinstance(result, Rejected)
    assert "names" in result.reason
