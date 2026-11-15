/** One originating attack. A derived application retains this request. */
export interface DamageRequest {
  readonly attackId: string;
  readonly attackerId: string;
  readonly targetId: string;
  readonly baseDamage: number;
}

/** The amount and recipient for a single application of the request. */
export interface DamageContext {
  readonly request: DamageRequest;
  readonly targetId: string;
  readonly amount: number;
  readonly transferred?: true;
}

interface DamagePools {
  readonly shield: number;
  readonly hp: number;
}

export interface DamageResult {
  readonly barrierDamage?: number;
  readonly request: DamageRequest;
  readonly targetId: string;
  readonly shieldDamage: number;
  readonly hpDamage: number;
  readonly remaining: DamagePools;
  readonly lethal: boolean;
}

export function beginDamage(request: DamageRequest): DamageContext {
  return { request, targetId: request.targetId, amount: request.baseDamage };
}

export function transferDamage(context: DamageContext, targetId: string, amount: number): DamageContext {
  return { request: context.request, targetId, amount, transferred: true };
}

export function barrierResult(context: DamageContext, target: DamagePools, absorbed: number): DamageResult {
  return { request: context.request, targetId: context.targetId, barrierDamage: absorbed,
    shieldDamage: 0, hpDamage: 0, remaining: { shield: target.shield, hp: target.hp }, lethal: false };
}

/**
 * Resolve the pools after the context has passed through any modifiers and
 * special processing. Committing the result and emitting events belong to Battle.
 */
export function resolveDamage(context: DamageContext, target: DamagePools): DamageResult | undefined {
  const { amount, request, targetId } = context;
  if (target.hp <= 0 || !Number.isFinite(amount) || amount <= 0) return;

  const shield = Math.max(0, target.shield - amount);
  const overflow = Math.max(0, amount - target.shield);
  const hp = Math.max(0, target.hp - overflow);
  const shieldDamage = target.shield - shield;
  const hpDamage = target.hp - hp;
  if (shieldDamage === 0 && hpDamage === 0) return;

  return { request, targetId, shieldDamage, hpDamage, remaining: { shield, hp }, lethal: hp === 0 };
}
