"""
Django compatibility shim for legacy packages.

This module provides compatibility for packages that haven't been updated
to work with Django 4.0+ where smart_text was removed.
"""

# Monkey-patch django.utils.encoding to add back smart_text for legacy packages
try:
    from django.utils.encoding import smart_str, force_str
    # Add smart_text as alias for smart_str (removed in Django 4.0)
    import django.utils.encoding
    django.utils.encoding.smart_text = smart_str
    django.utils.encoding.force_text = force_str
except ImportError:
    pass
