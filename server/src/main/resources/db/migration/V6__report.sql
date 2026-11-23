create table report (
    id                uuid primary key,
    user_id           uuid not null references app_user (id),
    route_id          text not null references route (id),
    hike_id           uuid references hike (id),
    category          text not null check (category in
                        ('OBSTRUCTION','TRAIL_DAMAGE','CLOSURE','FIRE','WATER','WILDLIFE','SAFETY','CONDITIONS')),
    note              text not null default '',
    position          geography(Point, 4326),
    observed_at       timestamptz not null,
    last_confirmed_at timestamptz,
    cleared_at        timestamptz,
    received_at       timestamptz not null
);
create index report_route_idx on report (route_id);

create table report_confirmation (
    report_id   uuid not null references report (id),
    user_id     uuid not null references app_user (id),
    answer      text not null check (answer in ('STILL_THERE','GONE','NOT_SURE')),
    answered_at timestamptz not null,
    primary key (report_id, user_id)
);
