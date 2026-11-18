alter table app_user add column hike_revision bigint not null default 0;

create table hike (
    id                uuid primary key,             -- client-generated
    user_id           uuid not null references app_user (id),
    route_id          text not null references route (id),
    hiked_on          date,                         -- null = date not recorded
    notes             text not null default '',
    visibility        text not null check (visibility in ('PRIVATE', 'FRIENDS', 'PUBLIC')),
    notes_visibility  text not null check (notes_visibility in ('PRIVATE', 'FRIENDS', 'PUBLIC')),
    plan              jsonb,                        -- {approach?, main?, exit?, reversed}
    started_at        timestamptz,
    finished_at       timestamptz,
    client_updated_at timestamptz not null,         -- LWW key, already clamped
    deleted_at        timestamptz,
    revision          bigint not null,              -- per-user, from app_user.hike_revision
    received_at       timestamptz not null
);

create index hike_user_revision_idx on hike (user_id, revision);
create index hike_route_id_idx on hike (route_id);
