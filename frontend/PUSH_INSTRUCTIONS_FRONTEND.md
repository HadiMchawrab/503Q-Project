# Push instructions - Frontend package

Best workflow:

1. Mansour pushes the backend package first to GitHub.
2. Clone Mansour's repo.
3. Create a frontend branch.
4. Copy this package's `web/public/` folder into the cloned repo, replacing the placeholder.
5. Commit and push the frontend branch.
6. Open a Pull Request into `main`.

Commands after Mansour pushes backend:

```cmd
git clone https://github.com/YOUR_USERNAME/shopcloud-fastapi.git
cd shopcloud-fastapi
git checkout -b frontend/YOUR_NAME
```

Then copy this package's `web/public` folder into the cloned repo.

```cmd
git add web\public
git commit -m "Add customer storefront and admin frontend"
git push -u origin frontend/YOUR_NAME
```

If the professor wants separate repos instead, you can also push this frontend package directly:

```cmd
git init
git branch -M main
git add .
git commit -m "Add ShopCloud frontend"
git remote add origin https://github.com/YOUR_USERNAME/shopcloud-frontend.git
git push -u origin main
```
