# VantaHire Deployment Guide

## Railway Deployment

### Prerequisites
- Railway account
- PostgreSQL database provisioned on Railway

### Steps

1. **Connect Repository**
   - Go to Railway dashboard
   - Click "New Project" → "Deploy from GitHub repo"
   - Select this repository

2. **Add PostgreSQL Database**
   - Click "New" → "Database" → "Add PostgreSQL"
   - Railway will automatically set `DATABASE_URL` environment variable

3. **Set Environment Variables**
   Required variables:
   ```
   DATABASE_URL=<automatically set by Railway>
   SESSION_SECRET=<generate a strong random string>
   NODE_ENV=production
   ```

   Optional variables (see `.env.example` for full list):
   ```
   CLOUDINARY_CLOUD_NAME=<your-value>
   CLOUDINARY_API_KEY=<your-value>
   CLOUDINARY_API_SECRET=<your-value>
   OPENAI_API_KEY=<your-value>
   SPOTAXIS_BASE_URL=<your-value>
   ```

4. **Deploy**
   - Railway will automatically build and deploy
   - Build command: `npm install && npm run build`
   - Start command: `npm run start`

5. **Run Database Migrations**
   - After first deployment, run: `npm run db:push`
   - This creates the database tables

### SpotAxis Integration (Optional)

If deploying SpotAxis alongside VantaHire:

1. Deploy SpotAxis to Railway as a separate service
2. Set `SPOTAXIS_BASE_URL` to your SpotAxis deployment URL
3. Set `SPOTAXIS_CAREERS_URL` to your SpotAxis careers page URL

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string (auto-set by Railway) |
| `SESSION_SECRET` | Yes | Secret key for session encryption |
| `NODE_ENV` | Yes | Set to `production` |
| `PORT` | No | Auto-set by Railway (defaults to 5000) |
| `CLOUDINARY_CLOUD_NAME` | No | Cloudinary cloud name for file uploads |
| `CLOUDINARY_API_KEY` | No | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | No | Cloudinary API secret |
| `OPENAI_API_KEY` | No | OpenAI API key for AI job analysis |
| `SPOTAXIS_BASE_URL` | No | Base URL for SpotAxis integration |
| `SPOTAXIS_CAREERS_URL` | No | Careers page URL for SpotAxis |
| `NOTIFICATION_EMAIL` | No | Email for system notifications |

## Verifying Deployment

Once deployed:
1. Visit your Railway-provided URL
2. Check that the homepage loads
3. Try registering a new account
4. Verify database connection is working

## Troubleshooting

### Build fails
- Check that all dependencies are in `package.json`
- Verify Node.js version compatibility

### App crashes on startup
- Check Railway logs: `railway logs`
- Verify `DATABASE_URL` is set correctly
- Ensure `SESSION_SECRET` is set

### Database connection errors
- Verify PostgreSQL service is running
- Check `DATABASE_URL` format: `postgresql://user:password@host:port/database`
