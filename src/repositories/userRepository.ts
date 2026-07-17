/**
 * All user SQL. No hashing, no validation, no HTTP — those belong to the
 * service. This layer only knows how to read and write rows.
 */
import { pool, Queryable } from '../db';
import { PublicUser, User } from '../types/domain';

/** Every column except the hash. Used wherever a row leaves for the outside. */
const PUBLIC_COLUMNS = `id, email, display_name, phone, city, avatar_url,
                        is_active, last_seen_at, created_at, updated_at`;

export interface InsertUserInput {
  email: string;
  password_hash: string;
  display_name: string;
  city: string;
}

/**
 * Inserts a user and returns them without the hash.
 *
 * Throws the raw pg unique-violation (code 23505) if the email is taken; the
 * service catches it and translates. We do not pre-check with a SELECT, because
 * between the check and the insert another request could take the address —
 * the UNIQUE constraint is the only real guard.
 */
export async function insert(input: InsertUserInput, db: Queryable = pool): Promise<PublicUser> {
  const { rows } = await db.query<PublicUser>(
    `INSERT INTO users (email, password_hash, display_name, city)
     VALUES ($1, $2, $3, $4)
     RETURNING ${PUBLIC_COLUMNS}`,
    [input.email, input.password_hash, input.display_name, input.city],
  );
  const row = rows[0];
  if (!row) throw new Error('Insert returned no row');
  return row;
}

/**
 * The full row *including* password_hash — login needs it to compare against.
 * This is the one function that exposes the hash, and only authService calls it.
 */
export async function findByEmail(email: string, db: Queryable = pool): Promise<User | null> {
  const { rows } = await db.query<User>(`SELECT * FROM users WHERE email = $1`, [email]);
  return rows[0] ?? null;
}

export async function findById(id: number, db: Queryable = pool): Promise<PublicUser | null> {
  const { rows } = await db.query<PublicUser>(
    `SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

/**
 * Overwrites the hash. Takes an already-hashed value — this layer does not know
 * what bcrypt is, and a plaintext password must never reach it.
 *
 * `updated_at` moves too, so the row records when the credential last changed.
 */
export async function updatePassword(
  id: number,
  passwordHash: string,
  db: Queryable = pool,
): Promise<void> {
  await db.query(`UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1`, [
    id,
    passwordHash,
  ]);
}

/**
 * Stamps "last online" to now and returns it. Called when a socket connects and
 * again when it disconnects, so the value is always the most recent moment the
 * user was actually listening. Returns null only if the row vanished.
 */
export async function touchLastSeen(id: number, db: Queryable = pool): Promise<Date | null> {
  const { rows } = await db.query<{ last_seen_at: Date }>(
    `UPDATE users SET last_seen_at = now() WHERE id = $1 RETURNING last_seen_at`,
    [id],
  );
  return rows[0]?.last_seen_at ?? null;
}

/** The Cloudinary handle for the current avatar, or null if there isn't one of ours. */
export async function findAvatarPublicId(id: number, db: Queryable = pool): Promise<string | null> {
  const { rows } = await db.query<{ avatar_public_id: string | null }>(
    `SELECT avatar_public_id FROM users WHERE id = $1`,
    [id],
  );
  return rows[0]?.avatar_public_id ?? null;
}

export interface UpdateProfileFields {
  display_name?: string;
  city?: string | null;
  phone?: string | null;
  avatar_url?: string | null;
  avatar_public_id?: string | null;
}

/**
 * Applies only the fields present. The allow-list below is a guard, not a
 * comment: `email`, `password_hash` and `is_active` are unreachable from here
 * by construction, so a future caller cannot accidentally let a profile form
 * deactivate an account or take over an address.
 *
 * `avatar_public_id` is not in UpdateProfileInput — no client sends it. The
 * service derives it from the URL and passes it down alongside.
 */
export async function updateProfile(
  id: number,
  fields: UpdateProfileFields,
  db: Queryable = pool,
): Promise<PublicUser> {
  const assignments: string[] = [];
  const params: unknown[] = [];

  const updatable = ['display_name', 'city', 'phone', 'avatar_url', 'avatar_public_id'] as const;
  for (const column of updatable) {
    if (fields[column] !== undefined) {
      params.push(fields[column]);
      assignments.push(`${column} = $${params.length}`);
    }
  }

  // Nothing to write. Return the row as it stands rather than issuing an UPDATE
  // with an empty SET, which is a syntax error.
  if (assignments.length === 0) {
    const current = await findById(id, db);
    if (!current) throw new Error('User not found');
    return current;
  }

  assignments.push(`updated_at = now()`);
  params.push(id);

  const { rows } = await db.query<PublicUser>(
    `UPDATE users SET ${assignments.join(', ')}
     WHERE id = $${params.length}
     RETURNING ${PUBLIC_COLUMNS}`,
    params,
  );
  const row = rows[0];
  if (!row) throw new Error('User not found');
  return row;
}

/** The city a listing inherits when this user posts one (Slice 3). */
export async function findCity(id: number, db: Queryable = pool): Promise<string | null> {
  const { rows } = await db.query<{ city: string | null }>(`SELECT city FROM users WHERE id = $1`, [
    id,
  ]);
  return rows[0]?.city ?? null;
}
