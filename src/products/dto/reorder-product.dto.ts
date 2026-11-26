import { IsInt, Min } from 'class-validator';

// 1-indexed target position within the full, unfiltered admin Products
// list (see ProductsService.reorder) — e.g. 4 means "make this the 4th
// product", shifting whatever was there down by one.
export class ReorderProductDto {
  @IsInt()
  @Min(1)
  position: number;
}
