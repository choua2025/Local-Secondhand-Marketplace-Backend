import * as categoryRepository from '../repositories/categoryRepository';
import { CategorySummary } from '../types/dto';

/** The whole category tree, flat. The client nests it by parent_id. */
export async function list(): Promise<CategorySummary[]> {
  return categoryRepository.listAll();
}
