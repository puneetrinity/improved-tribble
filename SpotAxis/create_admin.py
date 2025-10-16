#!/usr/bin/env python
"""Create admin superuser for SpotAxis"""
import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'TRM.settings')
django.setup()

from common.models import User

username = 'admin'
email = 'admin@spotaxis.com'
password = 'SpotAxis2025!'

if User.objects.filter(username=username).exists():
    print(f'✓ User "{username}" already exists')
    user = User.objects.get(username=username)
    print(f'  Email: {user.email}')
    print(f'  Superuser: {user.is_superuser}')
else:
    user = User.objects.create_superuser(username, email, password)
    print(f'✓ Created superuser: {username}')
    print(f'  Email: {email}')
    print(f'  Password: {password}')
    print(f'\nLogin at: https://authentic-motivation-production.up.railway.app/admin/')
