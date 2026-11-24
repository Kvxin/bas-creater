def text obj_cparent {
    content = "父"
    x = 300
    y = 200
    duration = 4s
}

def text obj_cchild {
    content = "子"
    x = 0.1
    y = 0.2
    parent = "obj_cparent"
    duration = 4s
}
