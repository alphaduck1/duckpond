/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone', // smaller Cloud Run image
};
module.exports = nextConfig;
