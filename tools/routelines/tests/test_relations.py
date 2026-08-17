import json
from pathlib import Path

from kaap_routelines.relations import Member, Relation, read_relations, stitch
from kaap_routelines.ways import Way

# `read_relations` needs a way lookup, since geometry is joined on by id from
# the walkable-ways export rather than carried by the relation file itself.

A = (18.400, -34.000)
B = (18.410, -34.000)
C = (18.420, -34.000)
FAR = (18.500, -34.000)


def w(osm_id: int, *points) -> Way:
    return Way(osm_id=osm_id, name=None, coords=tuple(points))


def rel(*members: Member, name="Test Route", osm_id=99) -> Relation:
    return Relation(osm_id=osm_id, name=name, members=tuple(members))


def test_members_joining_end_to_start_make_one_part():
    result = stitch(rel(Member(w(1, A, B), ""), Member(w(2, B, C), "")))
    assert result.joined is True
    assert result.parts == (((18.400, -34.000), (18.410, -34.000), (18.420, -34.000)),)
    assert result.way_ids == (1, 2)


def test_a_member_recorded_backwards_is_reversed_to_join():
    # Mappers add members in walking order but a way's own direction is
    # arbitrary, so the second way here runs C->B. Refusing to flip it would
    # report a perfectly good relation as broken.
    result = stitch(rel(Member(w(1, A, B), ""), Member(w(2, C, B), "")))
    assert result.joined is True
    assert result.parts[0][-1] == C


def test_members_that_do_not_touch_stay_separate_parts():
    result = stitch(rel(Member(w(1, A, B), ""), Member(w(2, FAR, (18.51, -34.0)), "")))
    assert result.joined is False
    assert len(result.parts) == 2


def test_forward_and_backward_roles_are_emitted_as_their_own_parts():
    # Two of the region's relations use these roles for alternative or
    # directional sections. Concatenating them draws a line that doubles back
    # on itself, which is a shape the hike does not have.
    result = stitch(
        rel(
            Member(w(1, A, B), ""),
            Member(w(2, B, C), "forward"),
            Member(w(3, B, C), "backward"),
        )
    )
    assert result.joined is False
    assert len(result.parts) == 3
    assert result.way_ids == (1, 2, 3)


def test_roles_are_directional_when_no_member_is_plain():
    # Kasteelspoort's relation is 3 members, ALL role=forward, and Apostles
    # Path is 11 backward + 3 forward. Reading every role as "an alternative
    # section" left those relations with no main line at all and discarded
    # them — a route whose every member is an alternative is not a thing.
    # Where nothing is plain, the roles are saying which way you walk each
    # member, so the whole ordered list is the line.
    result = stitch(
        rel(
            Member(w(1, A, B), "forward"),
            Member(w(2, B, C), "forward"),
        )
    )
    assert result.joined is True
    assert result.parts[0] == (A, B, C)


def test_a_roled_member_beside_plain_ones_is_still_an_alternative():
    # The mixed case is unchanged: here `forward` really does mark a section
    # off the main line, and concatenating it would double the line back.
    result = stitch(
        rel(
            Member(w(1, A, B), ""),
            Member(w(2, B, C), ""),
            Member(w(3, B, C), "forward"),
        )
    )
    assert result.joined is False
    assert len(result.parts) == 2


def _osm_json(tmp_path, elements) -> Path:
    path = tmp_path / "route-relations.json"
    path.write_text(json.dumps({"version": "0.6", "elements": elements}), encoding="utf-8")
    return path


def _relation_element(osm_id, name, members, route="hiking"):
    return {
        "type": "relation",
        "id": osm_id,
        "tags": {"type": "route", "route": route, "name": name},
        "members": [{"type": "way", "ref": ref, "role": role} for ref, role in members],
    }


def test_reads_members_with_their_ids_and_roles(tmp_path):
    # The ids are the provenance every drawn line has to carry, and the roles
    # are what stops an alternative section being concatenated into the line.
    # osmium's GeoJSON export drops both, which is why this reads OSM JSON.
    path = _osm_json(tmp_path, [
        _relation_element(2934380, "Platteklip Gorge", [(101, ""), (102, "forward")])
    ])
    ways_by_id = {101: w(101, A, B), 102: w(102, B, C)}

    relations = read_relations(path, ways_by_id)
    assert len(relations) == 1
    assert relations[0].osm_id == 2934380
    assert relations[0].name == "Platteklip Gorge"
    assert [(m.way.osm_id, m.role) for m in relations[0].members] == [(101, ""), (102, "forward")]
    assert relations[0].missing == 0


def test_counts_a_member_whose_geometry_is_absent(tmp_path):
    # A member that is not a walkable highway is not in walkable-ways.geojsonl.
    # Counted, not silently dropped: a relation with a hole in it must not be
    # promoted to a route line as though it were complete.
    path = _osm_json(tmp_path, [_relation_element(1, "Gappy", [(101, ""), (999, "")])])
    relations = read_relations(path, {101: w(101, A, B)})
    assert relations[0].missing == 1
    assert len(relations[0].members) == 1


def test_ignores_a_relation_that_is_not_a_hiking_route(tmp_path):
    path = _osm_json(tmp_path, [_relation_element(1, "Bus 104", [(101, "")], route="bus")])
    assert read_relations(path, {101: w(101, A, B)}) == []


def test_reads_osm_xml_as_well_as_osm_json(tmp_path):
    # What the extract actually writes. osmium's JSON writer is a compile-time
    # option Ubuntu's package omits, so `osmium cat -f json` fails outright and
    # XML is the format that keeps member ids and roles. Both are accepted so
    # neither the tool's build options nor a format change can empty this tier.
    path = tmp_path / "route-relations.osm"
    path.write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<osm version="0.6">\n'
        '  <relation id="2934380" version="7">\n'
        '    <member type="way" ref="101" role=""/>\n'
        '    <member type="way" ref="102" role="forward"/>\n'
        '    <member type="relation" ref="55" role=""/>\n'
        '    <tag k="type" v="route"/>\n'
        '    <tag k="route" v="hiking"/>\n'
        '    <tag k="name" v="Platteklip Gorge"/>\n'
        '  </relation>\n'
        '</osm>\n',
        encoding="utf-8",
    )
    relations = read_relations(path, {101: w(101, A, B), 102: w(102, B, C)})
    assert len(relations) == 1
    assert relations[0].osm_id == 2934380
    assert relations[0].name == "Platteklip Gorge"
    assert [(m.way.osm_id, m.role) for m in relations[0].members] == [(101, ""), (102, "forward")]
    # The relation member is not a way and carries no geometry of its own; it
    # is skipped rather than counted as a hole in this relation.
    assert relations[0].missing == 0


def test_ignores_ways_and_nodes_in_the_same_file(tmp_path):
    path = _osm_json(tmp_path, [
        {"type": "way", "id": 101, "nodes": [1, 2], "tags": {"highway": "path"}},
        _relation_element(1, "Real Route", [(101, "")]),
    ])
    assert len(read_relations(path, {101: w(101, A, B)})) == 1
