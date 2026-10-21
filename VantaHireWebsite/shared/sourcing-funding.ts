import {z} from 'zod';

const revision=z.string().regex(/^(0|[1-9][0-9]*)$/);
const time=z.string().datetime({offset:true});
export const searchFundingSchema=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('included'),slotId:z.string().uuid(),windowStart:time,revision}).strict(),
  z.object({kind:z.literal('extra'),grantId:z.string().uuid(),revision,expiresAt:time}).strict(),
]);
export const searchBudgetFields={
  quoteVersion:z.literal(2),funding:searchFundingSchema,
  includedRemaining:z.number().int().min(0).max(5),extraRemaining:z.number().int().nonnegative().safe(),
};
