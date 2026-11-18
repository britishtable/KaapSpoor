create table app_user (
    id             uuid primary key,
    email          text,
    email_verified boolean not null default false,
    password_hash  text,
    display_name   text not null,
    role           text not null default 'USER' check (role in ('USER', 'ADMIN')),
    created_at     timestamptz not null,
    deleted_at     timestamptz
);

-- Emails are stored normalised (trimmed, lower-cased), so plain equality is the right key.
create unique index app_user_email_idx on app_user (email) where email is not null;

create table identity (
    provider text not null,
    subject  text not null,
    user_id  uuid not null references app_user (id),
    primary key (provider, subject)
);

create index identity_user_id_idx on identity (user_id);

-- Only SHA-256(token) is stored; the raw refresh token never reaches the database.
create table refresh_token (
    id         uuid primary key,
    user_id    uuid not null references app_user (id),
    family_id  uuid not null,
    token_hash bytea not null unique,
    expires_at timestamptz not null,
    used_at    timestamptz,
    revoked_at timestamptz,
    created_at timestamptz not null
);

create index refresh_token_family_id_idx on refresh_token (family_id);
create index refresh_token_user_id_idx on refresh_token (user_id);
