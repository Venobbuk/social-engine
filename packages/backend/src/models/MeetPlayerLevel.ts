/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { PrimaryColumn, Entity, Index, JoinColumn, Column, ManyToOne } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';

// Per-user, per-sport level record used by meet gates. Filled by the host adapter (hkpl SSO carries
// dupr_rating) and by the user's own self rating. One row per (user, sport).
@Entity('meet_player_level')
@Index(['userId', 'sport'], { unique: true })
export class MiMeetPlayerLevel {
	@PrimaryColumn(id())
	public id: string;

	@Index()
	@Column(id())
	public userId: MiUser['id'];

	@ManyToOne(() => MiUser, { onDelete: 'CASCADE' })
	@JoinColumn()
	public user: MiUser | null;

	@Column('varchar', { length: 32, default: 'pickleball' })
	public sport: string;

	@Column('double precision', { nullable: true })
	public selfLevel: number | null;

	@Column('double precision', { nullable: true })
	public duprSingles: number | null;

	@Column('double precision', { nullable: true })
	public duprDoubles: number | null;

	@Column('varchar', { length: 64, nullable: true })
	public duprId: string | null;

	@Column('varchar', { length: 16, nullable: true, comment: 'male | female | nonbinary' })
	public gender: string | null;

	@Column('varchar', { length: 16, nullable: true, comment: 'junior | adult | senior' })
	public ageGroup: string | null;

	@Column('varchar', { length: 32, nullable: true, comment: 'Where the DUPR values came from (hkpl, self…).' })
	public source: string | null;

	@Column('timestamp with time zone', { nullable: true })
	public updatedAt: Date | null;
}
