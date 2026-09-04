<?php

namespace App\Http\Controllers\Api\V1\General;

use App\Http\Controllers\Controller;
use App\Models\RetailerWrappedCampaign;
use App\Models\RetailerWrappedCampaignAudienceCompiled;
use App\Helpers\S3Helper;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Redis;

class WrapController extends Controller
{
    /**
     * Entrypoint API untuk mengambil data campaign wrapped retailer
     */
    public function index(Request $request)
    {
        // 1. Validasi Input Request
        $request->validate([
            'campaign_id' => 'required|string',
            'source_app'  => 'nullable|string',
            'reload'      => 'nullable|boolean',
        ]);

        // 2. Identity Resolution
        $user = Auth::user();
        $businessId = $user ? $user->business_id : null;
        $campaignId = $request->input('campaign_id');

        // 3. Verifikasi Campaign
        $campaign = RetailerWrappedCampaign::where('id', $campaignId)->firstOrFail();

        // 4. Redis Cache Check / Invalidation
        $cacheKey = "ayowrap_{$campaignId}";
        if ($request->boolean('reload')) {
            Redis::hdel($cacheKey, (string) $businessId);
            $raw = null;
        } else {
            $raw = Redis::hget($cacheKey, (string) $businessId);
        }

        // 5. Cache HIT
        if (!empty($raw)) {
            $cachedData = $this->processRedisData($raw, $user, $campaign);
            return response()->json([
                'status' => 'success',
                'data'   => $cachedData
            ], 200);
        }

        // 6. Cache MISS (Ambil dari DB Audience Compiled & AWS S3)
        $data = $this->fetchAndProcessS3Data($campaign, $user);

        return response()->json([
            'status' => 'success',
            'data'   => $data
        ], 200);
    }

    /**
     * Private helper untuk memproses data dari Redis
     */
    private function processRedisData($raw, $user, $campaign)
    {
        return json_decode($raw, true);
    }

    /**
     * Private helper untuk mengambil rekaman DB dan konten S3
     */
    private function fetchAndProcessS3Data($campaign, $user)
    {
        $businessId = $user ? $user->business_id : null;

        // Query ke Audience Compiled Database
        $record = RetailerWrappedCampaignAudienceCompiled::where('campaign_id', $campaign->id)
            ->where('retailer_id', $businessId)
            ->first();

        if (!$record || empty($record->s3_path)) {
            return $this->getFallbackResponse();
        }

        // Panggil helper S3 internal
        $rawS3 = $this->getS3Data($record->s3_path);
        if (!$rawS3) {
            return $this->getFallbackResponse();
        }

        $retailerData = json_decode($rawS3, true);
        if (empty($retailerData)) {
            return $this->getFallbackResponse();
        }

        // Simpan hasil ke cache Redis
        $this->saveToRedis($campaign->id, $businessId, $retailerData);

        return [
            'user'   => $user,
            'slides' => $retailerData
        ];
    }

    /**
     * Private helper untuk membaca object dari AWS S3
     */
    private function getS3Data($path)
    {
        try {
            return S3Helper::getObjectContent($path);
        } catch (\Exception $e) {
            return null;
        }
    }

    /**
     * Private helper untuk menyimpan payload ke Redis dengan TTL
     */
    private function saveToRedis($campaignId, $businessId, $data)
    {
        $cacheKey = "ayowrap_{$campaignId}";
        Redis::hset($cacheKey, (string) $businessId, json_encode($data));

        $ttl = 86400; // e.g. diffInSeconds
        Redis::expire($cacheKey, $ttl);
    }

    /**
     * Fallback default response saat terjadi missing data atau S3 error
     */
    private function getFallbackResponse()
    {
        return [
            'user'   => [],
            'slides' => []
        ];
    }
}
