# bugfix-null-check-02

`getName` crashes when `user.profile` is null. Add a null guard so the function returns `""` instead.
