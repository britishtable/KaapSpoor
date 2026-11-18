create table route (
    id              text primary key,
    title           text not null,
    area            text[] not null,
    location        geography(Point, 4326),
    location_source text,
    retired_at      timestamptz,
    updated_at      timestamptz not null
);

create index route_location_idx on route using gist (location);
