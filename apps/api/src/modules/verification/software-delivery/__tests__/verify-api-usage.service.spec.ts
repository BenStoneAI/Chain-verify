import { vi, describe, it, expect, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { HttpException } from '@nestjs/common';
import { VerifyApiUsageService, SOFTWARE_DELIVERY_USAGE_PRODUCT } from '../verify-api-usage.service.js';
import { PrismaService } from '../../../database/prisma.service.js';

describe('VerifyApiUsageService', () => {
  let service: VerifyApiUsageService;
  const mockFindUnique = vi.fn();
  const mockUpsert = vi.fn();

  beforeEach(async () => {
    vi.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        VerifyApiUsageService,
        {
          provide: PrismaService,
          useValue: {
            verifyApiUsage: {
              findUnique: mockFindUnique,
              upsert: mockUpsert,
            },
          },
        },
      ],
    }).compile();
    service = module.get(VerifyApiUsageService);
  });

  it('returns zero when no usage row exists', async () => {
    mockFindUnique.mockResolvedValue(null);
    await expect(service.getMonthlyCount('org-1', SOFTWARE_DELIVERY_USAGE_PRODUCT)).resolves.toBe(0);
  });

  it('increments usage via upsert', async () => {
    mockUpsert.mockResolvedValue({ count: 3 });
    await expect(service.increment('org-1', SOFTWARE_DELIVERY_USAGE_PRODUCT)).resolves.toBe(3);
  });

  it('throws 429 when monthly limit is reached', async () => {
    mockFindUnique.mockResolvedValue({ count: 50 });
    await expect(
      service.assertWithinLimit('org-1', SOFTWARE_DELIVERY_USAGE_PRODUCT, 50),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('reserve atomically claims a unit and allows it when under the limit', async () => {
    mockUpsert.mockResolvedValue({ count: 50 });
    await expect(
      service.reserve('org-1', SOFTWARE_DELIVERY_USAGE_PRODUCT, 50),
    ).resolves.toBe(50);
    expect(mockUpsert).toHaveBeenCalledTimes(1);
  });

  it('reserve throws 429 when the claimed count exceeds the limit', async () => {
    mockUpsert.mockResolvedValue({ count: 51 });
    await expect(
      service.reserve('org-1', SOFTWARE_DELIVERY_USAGE_PRODUCT, 50),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('reserve treats a null limit as unlimited', async () => {
    mockUpsert.mockResolvedValue({ count: 9999 });
    await expect(
      service.reserve('org-1', SOFTWARE_DELIVERY_USAGE_PRODUCT, null),
    ).resolves.toBe(9999);
  });
});
