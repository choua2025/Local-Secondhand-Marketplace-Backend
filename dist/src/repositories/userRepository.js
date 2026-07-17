"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.insert = insert;
exports.findByEmail = findByEmail;
exports.findById = findById;
exports.updatePassword = updatePassword;
exports.touchLastSeen = touchLastSeen;
exports.findAvatarPublicId = findAvatarPublicId;
exports.updateProfile = updateProfile;
exports.findCity = findCity;
/**
 * All user SQL. No hashing, no validation, no HTTP — those belong to the
 * service. This layer only knows how to read and write rows.
 */
const db_1 = require("../db");
/** Every column except the hash. Used wherever a row leaves for the outside. */
const PUBLIC_COLUMNS = `id, email, display_name, phone, city, avatar_url,
                        is_active, last_seen_at, created_at, updated_at`;
/**
 * Inserts a user and returns them without the hash.
 *
 * Throws the raw pg unique-violation (code 23505) if the email is taken; the
 * service catches it and translates. We do not pre-check with a SELECT, because
 * between the check and the insert another request could take the address —
 * the UNIQUE constraint is the only real guard.
 */
async function insert(input, db = db_1.pool) {
    const { rows } = await db.query(`INSERT INTO users (email, password_hash, display_name, city)
     VALUES ($1, $2, $3, $4)
     RETURNING ${PUBLIC_COLUMNS}`, [input.email, input.password_hash, input.display_name, input.city]);
    const row = rows[0];
    if (!row)
        throw new Error('Insert returned no row');
    return row;
}
/**
 * The full row *including* password_hash — login needs it to compare against.
 * This is the one function that exposes the hash, and only authService calls it.
 */
async function findByEmail(email, db = db_1.pool) {
    const { rows } = await db.query(`SELECT * FROM users WHERE email = $1`, [email]);
    return rows[0] ?? null;
}
async function findById(id, db = db_1.pool) {
    const { rows } = await db.query(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = $1`, [id]);
    return rows[0] ?? null;
}
/**
 * Overwrites the hash. Takes an already-hashed value — this layer does not know
 * what bcrypt is, and a plaintext password must never reach it.
 *
 * `updated_at` moves too, so the row records when the credential last changed.
 */
async function updatePassword(id, passwordHash, db = db_1.pool) {
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
async function touchLastSeen(id, db = db_1.pool) {
    const { rows } = await db.query(`UPDATE users SET last_seen_at = now() WHERE id = $1 RETURNING last_seen_at`, [id]);
    return rows[0]?.last_seen_at ?? null;
}
/** The Cloudinary handle for the current avatar, or null if there isn't one of ours. */
async function findAvatarPublicId(id, db = db_1.pool) {
    const { rows } = await db.query(`SELECT avatar_public_id FROM users WHERE id = $1`, [id]);
    return rows[0]?.avatar_public_id ?? null;
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
async function updateProfile(id, fields, db = db_1.pool) {
    const assignments = [];
    const params = [];
    const updatable = ['display_name', 'city', 'phone', 'avatar_url', 'avatar_public_id'];
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
        if (!current)
            throw new Error('User not found');
        return current;
    }
    assignments.push(`updated_at = now()`);
    params.push(id);
    const { rows } = await db.query(`UPDATE users SET ${assignments.join(', ')}
     WHERE id = $${params.length}
     RETURNING ${PUBLIC_COLUMNS}`, params);
    const row = rows[0];
    if (!row)
        throw new Error('User not found');
    return row;
}
/** The city a listing inherits when this user posts one (Slice 3). */
async function findCity(id, db = db_1.pool) {
    const { rows } = await db.query(`SELECT city FROM users WHERE id = $1`, [
        id,
    ]);
    return rows[0]?.city ?? null;
}
//# sourceMappingURL=userRepository.js.map