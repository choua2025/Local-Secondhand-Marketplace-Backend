import { Request, Response } from 'express';
import * as categoryService from '../services/categoryService';

export async function list(_req: Request, res: Response): Promise<void> {
  res.json(await categoryService.list());
}
